-- WS2 — courier dispatch: scoring + atomic claim + offer-cascade (research §2.3).
-- Push model layered ON TOP of the existing pull model: assign_courier stays as
-- degraded-mode fallback; WS1 guards (row locks, idempotent no-ops, compare-and-set)
-- are reused, not redesigned. Geo is haversine on nullable lat/lng with a 6 km
-- default until WS3 (PostGIS) lands — not a blocker.

-- Restaurant coordinates (nullable, additive; WS3 upgrades to PostGIS later).
alter table public.restaurants
  add column if not exists lat numeric(9, 6),
  add column if not exists lng numeric(9, 6);

-- ---- Offer table ----
create table if not exists public.dispatch_offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  courier_id uuid not null references public.couriers(id) on delete cascade,
  wave int not null default 1,
  score numeric(8, 2) not null,
  distance_km numeric(6, 2),
  status text not null default 'offered'
    check (status in ('offered', 'accepted', 'declined', 'expired', 'cancelled')),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

-- Invariants: at most ONE live offer per order, ONE live offer per courier.
create unique index if not exists dispatch_offers_live_per_order on public.dispatch_offers(order_id) where status = 'offered';
create unique index if not exists dispatch_offers_live_per_courier on public.dispatch_offers(courier_id) where status = 'offered';
-- Never re-offer the same order to the same courier.
create unique index if not exists dispatch_offers_order_courier_once on public.dispatch_offers(order_id, courier_id);
create index if not exists dispatch_offers_courier_hist_idx on public.dispatch_offers(courier_id, created_at desc);
create index if not exists dispatch_offers_expiry_idx on public.dispatch_offers(expires_at) where status = 'offered';

alter table public.dispatch_offers enable row level security;

drop policy if exists "dispatch_offers_courier_read" on public.dispatch_offers;
create policy "dispatch_offers_courier_read" on public.dispatch_offers
  for select using (courier_id = public.current_courier_id());
drop policy if exists "dispatch_offers_admin_read" on public.dispatch_offers;
create policy "dispatch_offers_admin_read" on public.dispatch_offers
  for select using (has_role('platform_admin'));
-- Deliberately NO insert/update policy — offers are written only by the
-- security-definer RPCs below (same pattern as delivery_status_events).

-- Realtime: courier app subscribes row-filtered (courier_id=eq.X). Guarded add.
do $do$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dispatch_offers'
  ) then
    alter publication supabase_realtime add table public.dispatch_offers;
  end if;
end
$do$;

-- ---- Helpers ----
create or replace function public.haversine_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric
language sql immutable
as $$
  select (6371 * 2 * asin(sqrt(
    power(sin(radians((lat2 - lat1) / 2)), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians((lng2 - lng1) / 2)), 2)
  )))::numeric;
$$;

-- Capacity in ONE place so WS5 batching only swaps this body
-- (single-active-delivery -> active_count < max_concurrent_deliveries).
create or replace function public.courier_has_capacity(p_courier_id uuid)
returns boolean
language sql stable
set search_path = public
as $$
  select not exists (
    select 1 from public.orders
    where courier_id = p_courier_id
      and status in ('courier_assigned', 'picked_up', 'en_route')
  );
$$;

-- ---- Dispatch engine: candidate generation + scoring + offer insert ----
-- Internal only (called by mark_ready_for_pickup, decline RPC, sweeper).
create or replace function public.dispatch_order(p_order_id uuid)
returns uuid -- new offer id, or null (no candidates / not dispatchable)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_cand record;
  v_wave int;
  v_offer_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    return null; -- already claimed / cancelled — no-op
  end if;
  if exists (select 1 from public.dispatch_offers where order_id = p_order_id and status = 'offered') then
    return null; -- live offer in flight — idempotent
  end if;

  select coalesce(max(wave), 0) + 1 into v_wave from public.dispatch_offers where order_id = p_order_id;
  if v_wave > 5 then
    return null; -- cascade cap: order remains visible in the pull feed
  end if;

  -- Candidates: online, active, capacity, no live offer, never offered this order.
  -- Score (lower = better) = ETA-to-restaurant (min) + acceptance penalty.
  select c.id as courier_id, d.dist_km,
         round(d.dist_km / v.speed_kmh * 60 + (1 - acc.rate) * 10, 2) as score
  into v_cand
  from public.couriers c
  join public.restaurants r on r.id = v_order.restaurant_id
  left join public.courier_locations cl
    on cl.courier_id = c.id and cl.updated_at > now() - interval '10 minutes'
  cross join lateral (
    select case c.vehicle_type
      when 'bike' then 12 when 'e_bike' then 18 when 'scooter' then 25
      when 'car' then 22 else 5 end::numeric as speed_kmh
  ) v
  cross join lateral (
    -- stale/no GPS or restaurant not geocoded -> neutral 6 km assumption
    select coalesce(public.haversine_km(cl.lat, cl.lng, r.lat, r.lng), 6.0) as dist_km
  ) d
  left join lateral (
    -- 14-day acceptance rate from this very table; expired counts against
    select case when count(*) = 0 then 1.0
      else avg((o2.status = 'accepted')::int)::numeric end as rate
    from public.dispatch_offers o2
    where o2.courier_id = c.id
      and o2.status in ('accepted', 'declined', 'expired')
      and o2.created_at > now() - interval '14 days'
  ) acc on true
  where c.status = 'online' and c.is_active
    and public.courier_has_capacity(c.id)
    and not exists (select 1 from public.dispatch_offers lo
                    where lo.courier_id = c.id and lo.status = 'offered')
    and not exists (select 1 from public.dispatch_offers po
                    where po.courier_id = c.id and po.order_id = p_order_id)
  order by score asc
  limit 1;

  if v_cand.courier_id is null then
    return null; -- nobody eligible; sweeper retries next tick
  end if;

  insert into public.dispatch_offers (order_id, courier_id, wave, score, distance_km, expires_at)
  values (p_order_id, v_cand.courier_id, v_wave, v_cand.score, v_cand.dist_km, now() + interval '30 seconds')
  returning id into v_offer_id;
  return v_offer_id;
end;
$$;
revoke execute on function public.dispatch_order(uuid) from public, anon, authenticated;

-- ---- Courier response RPCs ----
create or replace function public.accept_dispatch_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_offer public.dispatch_offers%rowtype;
  v_courier_id uuid;
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;

  select * into v_offer from public.dispatch_offers where id = p_offer_id for update;
  if not found or v_offer.courier_id <> v_courier_id then raise exception 'offer not found'; end if;
  if v_offer.status = 'accepted' then return; end if; -- idempotent retry (WS1 pattern)
  if v_offer.status <> 'offered' or v_offer.expires_at <= now() then
    raise exception 'oferta a expirat';
  end if;
  if not public.courier_has_capacity(v_courier_id) then
    raise exception 'you already have an active delivery';
  end if;

  -- ATOMIC CLAIM (compare-and-set): only wins if still unclaimed. Serializes
  -- against pull assign_courier and any concurrent dispatch — same split-brain
  -- guard WS1 uses in expire_stale_orders.
  update public.orders
  set status = 'courier_assigned', courier_id = v_courier_id
  where id = v_offer.order_id and status = 'ready_for_pickup' and courier_id is null;
  if not found then
    update public.dispatch_offers set status = 'cancelled', responded_at = now() where id = p_offer_id;
    raise exception 'comanda nu mai este disponibilă';
  end if;

  update public.dispatch_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update public.couriers set status = 'on_delivery' where id = v_courier_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (v_offer.order_id, 'courier_assigned', 'courier', auth.uid());
end;
$$;

create or replace function public.decline_dispatch_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_offer public.dispatch_offers%rowtype;
  v_courier_id uuid;
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;

  select * into v_offer from public.dispatch_offers where id = p_offer_id for update;
  if not found or v_offer.courier_id <> v_courier_id then raise exception 'offer not found'; end if;
  if v_offer.status = 'declined' then return; end if; -- idempotent
  if v_offer.status <> 'offered' then raise exception 'oferta nu mai este activă'; end if;

  update public.dispatch_offers set status = 'declined', responded_at = now() where id = p_offer_id;
  perform public.dispatch_order(v_offer.order_id); -- immediate cascade to next candidate
end;
$$;

grant execute on function public.accept_dispatch_offer(uuid) to authenticated;
grant execute on function public.decline_dispatch_offer(uuid) to authenticated;

-- ---- Sweeper: expire 30s offers + cascade + rescue undispatched orders ----
create or replace function public.expire_dispatch_offers()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_count int := 0;
begin
  for v_rec in
    with expired as (
      update public.dispatch_offers
      set status = 'expired', responded_at = now()
      where status = 'offered' and expires_at < now()
      returning order_id
    ) select order_id from expired
  loop
    perform public.dispatch_order(v_rec.order_id);
    v_count := v_count + 1;
  end loop;

  -- Orders ready_for_pickup with no live offer (e.g. no courier was online
  -- when marked ready): retry each tick; wave cap keeps it bounded.
  for v_rec in
    select o.id as order_id from public.orders o
    where o.status = 'ready_for_pickup' and o.courier_id is null
      and not exists (select 1 from public.dispatch_offers d
                      where d.order_id = o.id and d.status = 'offered')
  loop
    perform public.dispatch_order(v_rec.order_id);
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.expire_dispatch_offers() from public, anon, authenticated;

-- pg_cron seconds-granularity verified supported on this project (1.6).
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'expire-dispatch-offers') then
    perform cron.unschedule('expire-dispatch-offers');
  end if;
end
$do$;
select cron.schedule('expire-dispatch-offers', '15 seconds', $$select public.expire_dispatch_offers();$$);

-- ---- Hooks into existing RPCs (recreate, one added block each) ----
-- mark_ready_for_pickup: WS1 body verbatim + fire first dispatch in-line, non-fatal.
create or replace function public.mark_ready_for_pickup(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status = 'ready_for_pickup' then return; end if; -- idempotent
  if v_order.status <> 'accepted' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders set status = 'ready_for_pickup' where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'ready_for_pickup', (select role from public.profiles where id = auth.uid()), auth.uid());

  begin
    perform public.dispatch_order(p_order_id); -- WS2: push dispatch
  exception when others then
    raise warning 'dispatch_order(%) failed: %', p_order_id, sqlerrm; -- never block the restaurant
  end;
end;
$$;

-- assign_courier (pull fallback, WS1 behavior preserved via courier_has_capacity)
-- + cancel any live offer so the offered courier's card disappears.
create or replace function public.assign_courier(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_courier_id uuid;
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.courier_id = v_courier_id and v_order.status = 'courier_assigned' then return; end if;

  if not public.courier_has_capacity(v_courier_id) then
    raise exception 'you already have an active delivery';
  end if;
  if v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    raise exception 'order not available for assignment';
  end if;

  update public.orders set status = 'courier_assigned', courier_id = v_courier_id where id = p_order_id;
  update public.couriers set status = 'on_delivery' where id = v_courier_id;
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where order_id = p_order_id and status = 'offered'; -- WS2: kill live offer

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'courier_assigned', 'courier', auth.uid());
end;
$$;

-- cancel_order: WS1 behavior + idempotent no-ops + row lock + kill live offer.
create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if v_order.customer_id = auth.uid() then
    if v_order.status = 'cancelled' then return; end if; -- idempotent
    if v_order.status <> 'pending_restaurant' then raise exception 'too late to cancel'; end if;
  elsif not has_role('platform_admin') then
    raise exception 'not authorized';
  elsif v_order.status = 'cancelled' then return; end if; -- idempotent (admin)

  update public.orders set status = 'cancelled', cancellation_reason = p_reason where id = p_order_id;
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where order_id = p_order_id and status = 'offered'; -- WS2
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'cancelled', case when has_role('platform_admin') then 'platform_admin' else 'customer' end, auth.uid(), p_reason);
end;
$$;
