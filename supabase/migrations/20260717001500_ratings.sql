-- WS6 — post-delivery ratings & reviews (research §1.2). Additive only.
-- Writes go ONLY through submit_rating() (security definer) — deliberately no
-- INSERT/UPDATE/DELETE policies, same pattern as delivery_status_events, so a
-- client cannot forge/edit ratings or rate undelivered orders via direct writes.

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references auth.users(id),
  target_type text not null check (target_type in ('restaurant', 'courier')),
  restaurant_id uuid references public.restaurants(id),
  courier_id uuid references public.couriers(id),
  stars int not null check (stars between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  -- one rating per order per target — the core invariant
  unique (order_id, target_type),
  -- exactly one target populated, matching target_type
  check (
    (target_type = 'restaurant' and restaurant_id is not null and courier_id is null)
    or (target_type = 'courier' and courier_id is not null and restaurant_id is null)
  )
);

create index if not exists ratings_restaurant_idx on public.ratings(restaurant_id) where target_type = 'restaurant';
create index if not exists ratings_courier_idx on public.ratings(courier_id) where target_type = 'courier';

alter table public.ratings enable row level security;

-- Aggregates live as denormalized columns (public restaurant cards read them
-- with zero extra queries; restaurants already has public read RLS).
alter table public.restaurants
  add column if not exists rating_avg numeric(3, 2),
  add column if not exists rating_count int not null default 0;

alter table public.couriers
  add column if not exists rating_avg numeric(3, 2),
  add column if not exists rating_count int not null default 0;

-- RLS: scoped reads only. Raw rating rows (incl. customer_id + comment) are
-- NOT public — public surfaces use only the aggregate columns above.
drop policy if exists "ratings_customer_read_own" on public.ratings;
create policy "ratings_customer_read_own" on public.ratings
  for select using (customer_id = auth.uid());

drop policy if exists "ratings_partner_read" on public.ratings;
create policy "ratings_partner_read" on public.ratings
  for select using (
    target_type = 'restaurant' and has_restaurant_access(restaurant_id)
  );

drop policy if exists "ratings_courier_read_own" on public.ratings;
create policy "ratings_courier_read_own" on public.ratings
  for select using (
    target_type = 'courier'
    and courier_id in (select id from public.couriers where user_id = auth.uid())
  );

drop policy if exists "ratings_admin_all_read" on public.ratings;
create policy "ratings_admin_all_read" on public.ratings
  for select using (has_role('platform_admin'));

-- submit_rating RPC. WS1 conventions: `for update` row lock + idempotent retry +
-- auth check BEFORE any write.
create or replace function public.submit_rating(
  p_order_id uuid,
  p_target text,          -- 'restaurant' | 'courier'
  p_stars int,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_existing public.ratings%rowtype;
  v_delivered_at timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_target not in ('restaurant', 'courier') then raise exception 'invalid rating target'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'stars must be 1-5'; end if;

  -- Lock the order row: serializes concurrent double-submits on the same order
  -- (the unique constraint is the backstop).
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.customer_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_order.status <> 'delivered' then raise exception 'order not delivered yet'; end if;
  if p_target = 'courier' and v_order.courier_id is null then
    raise exception 'no courier on this order';
  end if;

  -- 30-day rating window, anchored on the real delivered event (audit trail).
  select max(created_at) into v_delivered_at
  from public.delivery_status_events
  where order_id = p_order_id and status = 'delivered';
  if v_delivered_at is not null and v_delivered_at < now() - interval '30 days' then
    raise exception 'rating window closed';
  end if;

  -- Idempotency (WS1 convention): identical retry = silent success;
  -- a *different* re-rating is rejected — ratings are immutable.
  select * into v_existing from public.ratings
  where order_id = p_order_id and target_type = p_target;
  if found then
    if v_existing.stars = p_stars then return; end if;
    raise exception 'already rated';
  end if;

  insert into public.ratings (order_id, customer_id, target_type, restaurant_id, courier_id, stars, comment)
  values (
    p_order_id,
    auth.uid(),
    p_target,
    case when p_target = 'restaurant' then v_order.restaurant_id end,
    case when p_target = 'courier' then v_order.courier_id end,
    p_stars,
    nullif(trim(p_comment), '')
  );

  -- Recompute aggregate from source of truth (no incremental drift; a lost
  -- race between two different orders self-heals on the next rating).
  if p_target = 'restaurant' then
    update public.restaurants r
    set rating_avg = sub.avg_stars, rating_count = sub.cnt
    from (
      select round(avg(stars)::numeric, 2) as avg_stars, count(*) as cnt
      from public.ratings
      where restaurant_id = v_order.restaurant_id and target_type = 'restaurant'
    ) sub
    where r.id = v_order.restaurant_id;
  else
    update public.couriers c
    set rating_avg = sub.avg_stars, rating_count = sub.cnt
    from (
      select round(avg(stars)::numeric, 2) as avg_stars, count(*) as cnt
      from public.ratings
      where courier_id = v_order.courier_id and target_type = 'courier'
    ) sub
    where c.id = v_order.courier_id;
  end if;
end;
$$;

grant execute on function public.submit_rating(uuid, text, int, text) to authenticated;
