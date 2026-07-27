-- Order 3 (observe-only — NO auto-compensation; the compensation design for
-- restaurant wait was cut in review). ARRIVAL CLOCK: the courier stamps the
-- moment they physically arrive at the restaurant. This powers ops/partner
-- KPIs (avg wait, avoidable wait, order 4) — it does NOT feed courier_fee_mdl.
-- advance_delivery_status's wait-term (courier_tariff, 20260727000900) stays
-- exactly as it shipped: v_wait_minutes hardcoded to 0. Verified below (see
-- footer note) — nothing to fix there, only the admin_reassign_courier bug.

alter table public.orders
  add column if not exists courier_arrived_restaurant_at timestamptz;

-- Assigned courier ONLY (no admin override — an admin reassigning a stuck
-- order goes through admin_reassign_courier, which now resets this clock,
-- not through this RPC), idempotent (first call wins, a retry/double-tap is a
-- no-op), and only while status = 'courier_assigned' — arriving is meaningful
-- exactly between "assigned" and "picked up", never before or after.
create or replace function public.courier_arrived_at_restaurant(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if v_order.courier_id not in (select id from public.couriers where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  if v_order.status <> 'courier_assigned' then
    raise exception 'invalid transition from %', v_order.status;
  end if;

  if v_order.courier_arrived_restaurant_at is not null then return; end if; -- idempotent

  update public.orders set courier_arrived_restaurant_at = now() where id = p_order_id;
end;
$function$;
revoke all on function public.courier_arrived_at_restaurant(uuid) from public, anon;
grant execute on function public.courier_arrived_at_restaurant(uuid) to authenticated;

-- BUG-FIX (mandatory): admin_reassign_courier recreated (CURRENT DB body,
-- verbatim otherwise) to NULL the arrival clock on reassign. Without this, a
-- rescuing courier inherits the ghosting courier's stale
-- courier_arrived_restaurant_at — their own arrival call then silently no-ops
-- (the idempotency guard above sees a non-null value and returns early), so
-- the rescuer's real wait is never recorded and they're locked out forever.
create or replace function public.admin_reassign_courier(p_order_id uuid, p_new_courier_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_order public.orders%rowtype;
  v_old_courier uuid;
  v_new public.couriers%rowtype;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status not in ('courier_assigned', 'picked_up', 'en_route') then
    raise exception 'comanda nu are un curier de reatribuit (stare %)', v_order.status;
  end if;
  v_old_courier := v_order.courier_id;

  select * into v_new from public.couriers where id = p_new_courier_id for update;
  if not found or not v_new.is_active then raise exception 'curierul nou nu este disponibil'; end if;
  if p_new_courier_id = v_old_courier then raise exception 'curierul nou este același cu cel curent'; end if;
  if not public.courier_has_capacity(p_new_courier_id) then
    raise exception 'curierul nou are deja o livrare activă';
  end if;

  -- The new courier is freshly assigned and heads to the restaurant. Reset the
  -- arrival clock: whatever the old courier stamped (or didn't) does not
  -- describe the new courier's trip.
  update public.orders
    set status = 'courier_assigned', courier_id = p_new_courier_id, courier_arrived_restaurant_at = null
    where id = p_order_id;

  -- Release the old courier ONLY if they were on this delivery (a ghost who went
  -- offline stays offline). Capacity = 1 active order, so they're now fully free.
  if v_old_courier is not null then
    update public.couriers set status = 'online' where id = v_old_courier and status = 'on_delivery';
  end if;
  update public.couriers set status = 'on_delivery' where id = p_new_courier_id;

  -- Kill any dangling live offer for this order.
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where order_id = p_order_id and status = 'offered';

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'courier_assigned', 'platform_admin', auth.uid(),
          format('reatribuit curier: %s → %s', coalesce(v_old_courier::text, '—'), p_new_courier_id::text));
end;
$function$;

-- admin_order_board (WS7) — additive columns for ops visibility into the
-- arrival clock. wait_seconds_since_arrival only ticks while the courier is
-- actually still waiting (courier_assigned + arrived); once picked up the
-- wait is over and belongs to history (admin_wait_metrics), not the live board.
-- Column list APPENDED at the end → admin_stuck_orders (select b.* from
-- admin_order_board) stays valid with zero changes.
create or replace view public.admin_order_board
with (security_invoker = on) as
select
  o.id, o.order_number, o.order_type, o.status,
  o.payment_method, o.payment_status, o.total_mdl,
  o.created_at, o.notes,
  o.restaurant_id, r.name as restaurant_name, r.accept_sla_minutes, r.avg_prep_minutes,
  o.courier_id, c.full_name as courier_name, c.status as courier_status,
  a.street_address, a.sector, a.lat as delivery_lat, a.lng as delivery_lng,
  coalesce(ev.entered_at, o.created_at) as in_state_since,
  extract(epoch from (now() - coalesce(ev.entered_at, o.created_at)))::int as in_state_seconds,
  o.courier_arrived_restaurant_at,
  case when o.status = 'courier_assigned' and o.courier_arrived_restaurant_at is not null
    then extract(epoch from (now() - o.courier_arrived_restaurant_at))::int
    else null end as wait_seconds_since_arrival
from public.orders o
join public.restaurants r on r.id = o.restaurant_id
left join public.couriers c on c.id = o.courier_id
left join public.addresses a on a.id = o.delivery_address_id
left join lateral (
  select min(e.created_at) as entered_at
  from public.delivery_status_events e
  where e.order_id = o.id and e.status = o.status
) ev on true
where o.status not in ('delivered', 'cancelled', 'rejected');

-- admin_wait_metrics — the 7-day ops summary tile source. avoidable_wait_orders_7d
-- uses a literal 5-minute placeholder here (matches the seeded default the next
-- migration, 20260727001100_avoidable_wait, ships as platform_settings.
-- avoidable_wait_grace_minutes) — that migration recreates this view to read the
-- real, admin-tunable grace instead. Single-row summary (no group by).
create or replace view public.admin_wait_metrics
with (security_invoker = on) as
with wait as (
  select
    o.id,
    extract(epoch from (pu.picked_up_at - o.courier_arrived_restaurant_at)) / 60 as wait_minutes
  from public.orders o
  cross join lateral (
    select min(e.created_at) as picked_up_at
    from public.delivery_status_events e
    where e.order_id = o.id and e.status = 'picked_up'
  ) pu
  where o.status = 'delivered'
    and o.delivered_at is not null
    and o.delivered_at >= now() - interval '7 days'
    and o.courier_arrived_restaurant_at is not null
    and pu.picked_up_at is not null
)
select
  round(avg(wait_minutes)::numeric, 1) as avg_wait_minutes_7d,
  count(*) filter (where wait_minutes > 5) as avoidable_wait_orders_7d
from wait;

revoke all on public.admin_wait_metrics from anon;
grant select on public.admin_wait_metrics to authenticated;

-- Footer note — advance_delivery_status verification (no change needed):
-- read the CURRENT DB body of advance_delivery_status (courier_tariff,
-- 20260727000900). Its wait term is `v_wait_minutes := 0;` — a hardcoded
-- literal, not a conditional reference to this column (the header comment
-- there was simply stale: "does not exist yet"). Per this task's observe-only
-- directive (no auto-compensation), that is the CORRECT behavior, not a bug —
-- leaving courier_fee_mdl computation untouched. If/when compensation for
-- restaurant wait is reinstated, that is a separate, deliberate migration.
