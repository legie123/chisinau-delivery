-- WS7 — Admin Ops Dashboard (research §4.6). Purely additive: 5 read views
-- (security_invoker => the CALLER's RLS applies, so platform_admin sees all via
-- existing admin-all/admin-read policies, anyone else sees only their own scope),
-- 1 payment RPC, realtime publication for the fleet panel. NO change to any
-- order-status write path — RLS stays the boundary.

-- Correctness fix: restaurants_public_read only exposes is_active=true rows to a
-- non-staff caller, so platform_admin would lose visibility of an INACTIVE
-- restaurant's in-flight orders (inner join drops them). Add an admin read-all.
drop policy if exists "restaurants_admin_read" on public.restaurants;
create policy "restaurants_admin_read" on public.restaurants
  for select using (has_role('platform_admin'));

-- ---- 1. Live order board: active orders + time spent in current state ----
create or replace view public.admin_order_board
with (security_invoker = on) as
select
  o.id, o.order_number, o.order_type, o.status,
  o.payment_method, o.payment_status, o.total_mdl,
  o.created_at, o.notes,
  o.restaurant_id, r.name as restaurant_name, r.accept_sla_minutes, r.avg_prep_minutes,
  o.courier_id, c.full_name as courier_name, c.status as courier_status,
  a.street_address, a.sector, a.lat as delivery_lat, a.lng as delivery_lng,
  coalesce(ev.last_event_at, o.created_at) as in_state_since,
  extract(epoch from (now() - coalesce(ev.last_event_at, o.created_at)))::int as in_state_seconds
from public.orders o
join public.restaurants r on r.id = o.restaurant_id
left join public.couriers c on c.id = o.courier_id
left join public.addresses a on a.id = o.delivery_address_id
left join lateral (
  select max(e.created_at) as last_event_at
  from public.delivery_status_events e
  where e.order_id = o.id
) ev on true
where o.status not in ('delivered', 'cancelled', 'rejected');

-- ---- 2. Stuck-order queue: active orders past per-state thresholds ----
-- pending_restaurant past SLA should never appear (WS1 sweeper cancels them);
-- if it does, pg_cron is broken => that row IS the alert.
create or replace view public.admin_stuck_orders
with (security_invoker = on) as
select b.*,
  case
    when b.status = 'pending_restaurant' then 'SLA depășit — sweeper-ul pg_cron nu a rulat'
    when b.status = 'accepted'           then 'Pregătire peste timpul estimat'
    when b.status = 'ready_for_pickup'   then 'Niciun curier nu a preluat comanda'
    when b.status = 'courier_assigned'   then 'Curierul nu a ridicat comanda'
    else 'Livrare care durează prea mult'
  end as stuck_reason
from public.admin_order_board b
where
     (b.status = 'pending_restaurant' and b.in_state_seconds > b.accept_sla_minutes * 60 + 120)
  or (b.status = 'accepted'           and b.in_state_seconds > (b.avg_prep_minutes + 15) * 60)
  or (b.status = 'ready_for_pickup'   and b.in_state_seconds > 15 * 60)
  or (b.status = 'courier_assigned'   and b.in_state_seconds > 15 * 60)
  or (b.status in ('picked_up', 'en_route') and b.in_state_seconds > 45 * 60);

-- ---- 3. Fleet status: courier + last location + active delivery ----
create or replace view public.admin_fleet_status
with (security_invoker = on) as
select
  c.id, c.full_name, c.phone, c.vehicle_type, c.status, c.is_active,
  cl.lat, cl.lng, cl.updated_at as location_updated_at,
  (cl.updated_at is null or cl.updated_at < now() - interval '3 minutes') as location_stale,
  ao.id as active_order_id, ao.order_number as active_order_number, ao.status as active_order_status
from public.couriers c
left join public.courier_locations cl on cl.courier_id = c.id
left join lateral (
  select o.id, o.order_number, o.status
  from public.orders o
  where o.courier_id = c.id and o.status in ('courier_assigned', 'picked_up', 'en_route')
  order by o.created_at desc limit 1
) ao on true;

-- ---- 4. Restaurant acceptance KPIs, rolling 7 days ----
create or replace view public.admin_restaurant_kpis
with (security_invoker = on) as
select
  r.id, r.name, r.is_active, r.accepting_orders, r.accept_sla_minutes,
  count(o.id) as orders_7d,
  count(*) filter (where acc.accepted_at is not null) as accepted_7d,
  count(*) filter (where rej.rejected_at is not null) as rejected_7d,
  count(*) filter (where sys.auto_cancelled_at is not null) as auto_cancelled_7d,
  round(
    count(*) filter (where acc.accepted_at is not null)::numeric
    / nullif(count(*) filter (where acc.accepted_at is not null or rej.rejected_at is not null or sys.auto_cancelled_at is not null), 0),
    3
  ) as acceptance_rate_7d,
  round(avg(extract(epoch from (acc.accepted_at - o.created_at)) / 60.0)::numeric, 1) as avg_accept_minutes_7d
from public.restaurants r
left join public.orders o
  on o.restaurant_id = r.id and o.created_at > now() - interval '7 days'
left join lateral (
  select min(e.created_at) as accepted_at from public.delivery_status_events e
  where e.order_id = o.id and e.status = 'accepted'
) acc on true
left join lateral (
  select min(e.created_at) as rejected_at from public.delivery_status_events e
  where e.order_id = o.id and e.status = 'rejected'
) rej on true
left join lateral (
  select min(e.created_at) as auto_cancelled_at from public.delivery_status_events e
  where e.order_id = o.id and e.status = 'cancelled' and e.actor_role = 'system'
) sys on true
group by r.id, r.name, r.is_active, r.accepting_orders, r.accept_sla_minutes;

-- ---- 5. Refund/dispute queue (cash-only MVP: anomalies, not gateway refunds) ----
create or replace view public.admin_payment_queue
with (security_invoker = on) as
select
  o.id, o.order_number, o.status, o.payment_method, o.payment_status,
  o.total_mdl, o.cancellation_reason, o.created_at, o.updated_at,
  r.name as restaurant_name, c.full_name as courier_name
from public.orders o
join public.restaurants r on r.id = o.restaurant_id
left join public.couriers c on c.id = o.courier_id
where o.payment_status in ('refund_pending', 'failed')
   or (o.status in ('cancelled', 'rejected') and o.payment_status = 'paid');

-- Views are read-only surfaces; expose only to logged-in users (RLS still scopes rows).
revoke all on public.admin_order_board, public.admin_stuck_orders,
  public.admin_fleet_status, public.admin_restaurant_kpis, public.admin_payment_queue
  from anon;
grant select on public.admin_order_board, public.admin_stuck_orders,
  public.admin_fleet_status, public.admin_restaurant_kpis, public.admin_payment_queue
  to authenticated;

-- ---- 6. Payment resolution RPC (only new write path; guarded + audited) ----
create or replace function public.admin_update_payment_status(
  p_order_id uuid, p_new_status text, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_allowed boolean;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.payment_status = p_new_status then return; end if; -- idempotent, WS1 style

  v_allowed := (v_order.payment_status, p_new_status) in (
    ('paid', 'refund_pending'),        -- open a dispute/refund on a collected cash order
    ('refund_pending', 'refunded'),    -- cash returned, close it
    ('refund_pending', 'paid'),        -- dispute rejected, keep the money
    ('failed', 'unpaid'),              -- reset a botched capture
    ('unpaid', 'paid')                 -- manual cash reconciliation
  );
  if not v_allowed then
    raise exception 'invalid payment transition % -> %', v_order.payment_status, p_new_status;
  end if;

  update public.orders set payment_status = p_new_status where id = p_order_id;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, v_order.status, 'platform_admin', auth.uid(),
          format('payment: %s -> %s%s', v_order.payment_status, p_new_status,
                 coalesce(' — ' || p_note, '')));
end;
$$;

grant execute on function public.admin_update_payment_status(uuid, text, text) to authenticated;

-- ---- 7. Realtime for fleet panel (orders already in publication, 000700) ----
do $do$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='couriers') then
    alter publication supabase_realtime add table public.couriers;
  end if;
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='courier_locations') then
    alter publication supabase_realtime add table public.courier_locations;
  end if;
end
$do$;
