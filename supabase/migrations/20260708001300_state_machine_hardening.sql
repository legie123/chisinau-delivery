-- WS1 — Order state-machine hardening (research §1.5, top recommendation).
-- Three additions, none relaxing authorization (RLS + actor checks stay):
--   1. Idempotent transitions: a retried action that would land on the state
--      the order is ALREADY in is a no-op success, not an error. Prevents
--      double-payout / ghost-duplicate events on client/network retries.
--   2. Restaurant accept-SLA auto-cancel: a per-restaurant deadline; a
--      pg_cron sweeper cancels orders stuck in pending_restaurant past it.
--   3. Split-brain safety: the sweeper cancels via a guarded UPDATE
--      (WHERE status = 'pending_restaurant'), so a partner accepting at the
--      same instant and the sweeper cannot both win — the row lock serializes
--      them and the WHERE clause makes the loser a no-op.

-- pg_cron for the timeout sweeper (additive extension, safe on shared project)
create extension if not exists pg_cron;

-- Per-restaurant acceptance SLA (minutes). Research cites 60-90s..5-7min;
-- default 7 min, tunable per restaurant.
alter table public.restaurants
  add column if not exists accept_sla_minutes int not null default 7 check (accept_sla_minutes > 0);

-- ---- Idempotent restaurant-side transitions ----

create or replace function public.accept_order(p_order_id uuid)
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
  if v_order.status = 'accepted' then return; end if; -- idempotent no-op
  if v_order.status <> 'pending_restaurant' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders set status = 'accepted' where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'accepted', (select role from public.profiles where id = auth.uid()), auth.uid());
end;
$$;

create or replace function public.reject_order(p_order_id uuid, p_reason text)
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
  if v_order.status = 'rejected' then return; end if; -- idempotent
  if v_order.status <> 'pending_restaurant' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders set status = 'rejected', cancellation_reason = p_reason where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'rejected', (select role from public.profiles where id = auth.uid()), auth.uid(), p_reason);
end;
$$;

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
end;
$$;

-- ---- Idempotent courier-side transitions ----

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
  -- idempotent: this courier already holds this order
  if v_order.courier_id = v_courier_id and v_order.status = 'courier_assigned' then return; end if;

  if exists (
    select 1 from public.orders
    where courier_id = v_courier_id and status in ('courier_assigned', 'picked_up', 'en_route')
  ) then
    raise exception 'you already have an active delivery';
  end if;

  if v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    raise exception 'order not available for assignment';
  end if;

  update public.orders set status = 'courier_assigned', courier_id = v_courier_id where id = p_order_id;
  update public.couriers set status = 'on_delivery' where id = v_courier_id;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'courier_assigned', 'courier', auth.uid());
end;
$$;

create or replace function public.advance_delivery_status(p_order_id uuid, p_new_status text, p_payment_confirmed boolean default null)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_allowed text[];
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if v_order.courier_id not in (select id from public.couriers where user_id = auth.uid()) and not has_role('platform_admin') then
    raise exception 'not authorized';
  end if;

  if v_order.status = p_new_status then return; end if; -- idempotent retry

  v_allowed := case v_order.status
    when 'courier_assigned' then array['picked_up']
    when 'picked_up' then array['en_route']
    when 'en_route' then array['delivered']
    else array[]::text[]
  end;
  if not (p_new_status = any(v_allowed)) then
    raise exception 'invalid transition % -> %', v_order.status, p_new_status;
  end if;

  update public.orders
  set status = p_new_status,
      payment_status = case
        when p_new_status = 'delivered' and p_payment_confirmed and payment_method <> 'online_gateway' then 'paid'
        else payment_status
      end
  where id = p_order_id;

  if p_new_status = 'delivered' then
    update public.couriers set status = 'online' where id = v_order.courier_id;
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, p_new_status, case when has_role('courier') then 'courier' else 'platform_admin' end, auth.uid());
end;
$$;

-- ---- Timeout sweeper: auto-cancel orders the restaurant never accepted ----
-- security definer, runs as owner (bypasses RLS) — invoked only by pg_cron,
-- never REST-exposed (no grant to anon/authenticated).
create or replace function public.expire_stale_orders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired record;
  v_count int := 0;
begin
  for v_expired in
    select o.id
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where o.status = 'pending_restaurant'
      and o.created_at < now() - make_interval(mins => r.accept_sla_minutes)
  loop
    -- Guarded UPDATE: if a partner accepts at this instant, the row lock
    -- serializes and only one side transitions the row.
    update public.orders
    set status = 'cancelled',
        cancellation_reason = 'Restaurantul nu a confirmat comanda la timp — anulare automată.'
    where id = v_expired.id and status = 'pending_restaurant';

    if found then
      insert into public.delivery_status_events (order_id, status, actor_role, note)
      values (v_expired.id, 'cancelled', 'system', 'accept SLA timeout');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.expire_stale_orders() from public, anon, authenticated;

-- Run every minute.
select cron.schedule('expire-stale-orders', '* * * * *', $$select public.expire_stale_orders();$$);
