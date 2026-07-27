-- Order 4 (observe-only — NO auto-compensation). AVOIDABLE WAIT: a per-restaurant
-- KPI surface for how much of the courier's wait at pickup is the restaurant's
-- fault (prep ran past estimate) vs a reasonable grace period. Also ships the
-- Glovo-model prep-time override: a merchant may correct the ETA before
-- accepting an order (never after — the customer/courier are already committed
-- to the estimate accept_order stamps).

-- platform_settings gets the admin-tunable grace. RLS on platform_settings is
-- admin-only (see 20260718000000_platform_foundation) — a security_invoker view
-- reading it directly would return ZERO rows for a restaurant partner (not "the
-- real value", not an error — just silently empty), which is exactly the kind
-- of quiet failure that ships broken KPI tiles. current_avoidable_wait_grace_minutes()
-- is the MANDATORY fix: SECURITY DEFINER, granted to authenticated, so any
-- caller gets the one live grace value without needing row access to the table.
alter table public.platform_settings
  add column if not exists avoidable_wait_grace_minutes int not null default 5
    check (avoidable_wait_grace_minutes >= 0);

create or replace function public.current_avoidable_wait_grace_minutes()
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select avoidable_wait_grace_minutes from public.platform_settings where id;
$$;
revoke all on function public.current_avoidable_wait_grace_minutes() from public, anon;
grant execute on function public.current_avoidable_wait_grace_minutes() to authenticated;

-- Recreate admin_wait_metrics (20260727001000) to read the real, tunable grace
-- instead of the 5-minute placeholder literal. Same two columns, same shape.
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
  count(*) filter (where wait_minutes > public.current_avoidable_wait_grace_minutes()) as avoidable_wait_orders_7d
from wait;

revoke all on public.admin_wait_metrics from anon;
grant select on public.admin_wait_metrics to authenticated;

-- Merchant prep-time override (Glovo model): editable ONLY pre-accept. Nullable —
-- when unset, accept_order falls back to get_prep_estimates() exactly as before.
alter table public.orders
  add column if not exists prep_time_override_minutes int
    check (prep_time_override_minutes is null or prep_time_override_minutes > 0);

create or replace function public.set_prep_time_estimate(p_order_id uuid, p_minutes int)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_order public.orders%rowtype;
begin
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'timpul de preparare trebuie să fie un număr pozitiv de minute';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;

  -- Glovo model: the override only exists to correct the ETA the customer and
  -- the courier are about to see for the FIRST time (stamped at accept). Once
  -- accepted, both parties are already committed to it — a silent post-accept
  -- edit would move the goalposts on them.
  if v_order.status <> 'pending_restaurant' then
    raise exception 'timpul de preparare se editează doar înainte de acceptare (stare curentă: %)', v_order.status;
  end if;

  update public.orders set prep_time_override_minutes = p_minutes where id = p_order_id;
end;
$function$;
revoke all on function public.set_prep_time_estimate(uuid, int) from public, anon;
grant execute on function public.set_prep_time_estimate(uuid, int) to authenticated;

-- Recreate accept_order (CURRENT DB body) to prefer the merchant's override
-- over the statistical estimate when stamping estimated_ready_at, WS4 dynamic
-- ETA (get_prep_estimates) unchanged as the fallback.
create or replace function public.accept_order(p_order_id uuid)
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
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status = 'accepted' then return; end if; -- idempotent no-op (WS1)
  if v_order.status <> 'pending_restaurant' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders
  set status = 'accepted',
      estimated_ready_at = case when v_order.order_type = 'standard'
        then now() + make_interval(mins => coalesce(
               v_order.prep_time_override_minutes,
               (select ge.prep_minutes from public.get_prep_estimates(array[v_order.restaurant_id]) ge)
             ))
        else null end
  where id = p_order_id;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'accepted', (select role from public.profiles where id = auth.uid()), auth.uid());
end;
$function$;

-- restaurant_wait_kpis — the partner-facing KPI chip row. security_invoker +
-- explicit has_restaurant_access(r.id) scoping (mandatory per spec): restaurants
-- RLS itself is public-read for is_active rows, so relying on it alone would
-- leak every restaurant's KPIs to every partner. This WHERE clause is the real
-- boundary — a partner only ever sees restaurants they're staffed at (or every
-- restaurant, if platform_admin). Rolling 30-day window (courier_pilot_kpis
-- precedent: 14d/28d; 30d chosen here for a low-volume-restaurant sample).
create or replace view public.restaurant_wait_kpis
with (security_invoker = on) as
with base as (
  select r.id as restaurant_id, r.name as restaurant_name
  from public.restaurants r
  where public.has_restaurant_access(r.id)
),
decisions as (
  -- reject-rate: rejected / (rejected + accepted-or-further), standard orders only
  -- (catering uses submit/decline_catering_quote, a different decision path).
  select
    o.restaurant_id,
    count(*) filter (where o.status = 'rejected') as rejected_30d,
    count(*) as decided_30d
  from public.orders o
  where o.order_type = 'standard'
    and o.created_at >= now() - interval '30 days'
    and o.status not in ('pending_restaurant', 'cancelled')
  group by o.restaurant_id
),
prep as (
  -- prep-accuracy: actual ready_for_pickup timestamp vs the estimate stamped at
  -- accept. Positive = ran late, negative = ran early.
  select
    o.restaurant_id,
    round(avg(extract(epoch from (rp.ready_at - o.estimated_ready_at)) / 60)::numeric, 1) as prep_accuracy_avg_minutes
  from public.orders o
  cross join lateral (
    select min(e.created_at) as ready_at
    from public.delivery_status_events e
    where e.order_id = o.id and e.status = 'ready_for_pickup'
  ) rp
  where o.order_type = 'standard'
    and o.estimated_ready_at is not null
    and rp.ready_at is not null
    and o.created_at >= now() - interval '30 days'
  group by o.restaurant_id
),
wait as (
  -- avg courier wait from the arrival clock (order 3) to actual pickup.
  select
    o.restaurant_id,
    extract(epoch from (pu.picked_up_at - o.courier_arrived_restaurant_at)) / 60 as wait_minutes
  from public.orders o
  cross join lateral (
    select min(e.created_at) as picked_up_at
    from public.delivery_status_events e
    where e.order_id = o.id and e.status = 'picked_up'
  ) pu
  where o.courier_arrived_restaurant_at is not null
    and pu.picked_up_at is not null
    and o.created_at >= now() - interval '30 days'
),
wait_agg as (
  select
    restaurant_id,
    round(avg(wait_minutes)::numeric, 1) as avg_courier_wait_minutes,
    count(*) filter (where wait_minutes > public.current_avoidable_wait_grace_minutes()) as avoidable_wait_orders
  from wait
  group by restaurant_id
)
select
  b.restaurant_id,
  b.restaurant_name,
  case when coalesce(d.decided_30d, 0) = 0 then null
       else round(100.0 * coalesce(d.rejected_30d, 0) / d.decided_30d, 1) end as reject_rate_pct,
  p.prep_accuracy_avg_minutes,
  wa.avg_courier_wait_minutes,
  coalesce(wa.avoidable_wait_orders, 0) as avoidable_wait_orders,
  public.current_avoidable_wait_grace_minutes() as avoidable_wait_grace_minutes
from base b
left join decisions d on d.restaurant_id = b.restaurant_id
left join prep p on p.restaurant_id = b.restaurant_id
left join wait_agg wa on wa.restaurant_id = b.restaurant_id;

revoke all on public.restaurant_wait_kpis from anon;
grant select on public.restaurant_wait_kpis to authenticated;
