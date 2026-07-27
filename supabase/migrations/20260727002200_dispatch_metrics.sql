-- Vetted order 10, item #1: admin dispatch-metrics dashboard. Views-only,
-- additive, NO new instrumentation tables/columns — computed live from
-- orders + delivery_status_events + dispatch_offers, rolling 7 days.
--
-- security_invoker = on: platform_admin already has read-all on every
-- underlying table (orders_admin_all, delivery_status_events_scoped_read's
-- has_role('platform_admin') branch, dispatch_offers_admin_read — see
-- 20260727001600_rls_fast_path.sql). PLUS an explicit has_role('platform_admin')
-- gate on the single output row: every metric column below is an
-- uncorrelated scalar subquery, so the `metrics` CTE always produces exactly
-- one row even when every subquery sees zero visible input rows (a bare
-- aggregate with no GROUP BY never returns zero rows) — RLS alone can't get
-- a non-admin down to zero rows here, the gate is what makes that
-- deterministic (mirrors dispatch_offers_admin_read's own has_role check).
create or replace view public.admin_dispatch_metrics
with (security_invoker = on) as
with ready_events as (
  select order_id, min(created_at) as ready_at
  from public.delivery_status_events
  where status = 'ready_for_pickup'
  group by order_id
),
assigned_events as (
  select order_id, min(created_at) as assigned_at
  from public.delivery_status_events
  where status = 'courier_assigned'
  group by order_id
),
picked_events as (
  select order_id, min(created_at) as picked_at
  from public.delivery_status_events
  where status = 'picked_up'
  group by order_id
),
accepted_events as (
  select order_id, min(created_at) as accepted_at
  from public.delivery_status_events
  where status = 'accepted'
  group by order_id
),
cancelled_events as (
  select order_id, min(created_at) as first_cancelled_at
  from public.delivery_status_events
  where status = 'cancelled'
  group by order_id
),
metrics as (
  select
    -- ready_for_pickup -> courier_assigned.
    (
      select round(avg(extract(epoch from (a.assigned_at - r.ready_at)))::numeric)::int
      from ready_events r
      join assigned_events a on a.order_id = r.order_id and a.assigned_at >= r.ready_at
      where r.ready_at >= now() - interval '7 days'
    ) as time_to_assign_avg_seconds,
    -- wave-1 offers accepted / wave-1 offers (any resolution: accepted/declined/expired/cancelled/still offered).
    (
      select case when count(*) = 0 then null
        else round((count(*) filter (where status = 'accepted'))::numeric / count(*), 3) end
      from public.dispatch_offers
      where wave = 1 and created_at >= now() - interval '7 days'
    ) as first_offer_acceptance_rate,
    -- max wave reached per dispatched order, averaged.
    (
      select round(avg(max_wave)::numeric, 2)
      from (
        select order_id, max(wave) as max_wave
        from public.dispatch_offers
        where created_at >= now() - interval '7 days'
        group by order_id
      ) mw
    ) as decline_cascade_depth_avg,
    -- ready_for_pickup -> picked_up. INCLUDES courier travel time to the
    -- restaurant, so this is an UPPER BOUND on the true restaurant-side wait,
    -- not the wait itself — the real arrival-clock-based wait
    -- (courier_arrived_restaurant_at -> picked_up) lives in admin_wait_metrics.
    (
      select round(avg(extract(epoch from (p.picked_at - r.ready_at)))::numeric)::int
      from ready_events r
      join picked_events p on p.order_id = r.order_id and p.picked_at >= r.ready_at
      where r.ready_at >= now() - interval '7 days'
    ) as restaurant_handover_avg_seconds,
    -- placed -> delivered.
    (
      select round((avg(extract(epoch from (o.delivered_at - o.created_at)) / 60))::numeric, 1)
      from public.orders o
      where o.status = 'delivered'
        and o.delivered_at is not null
        and o.delivered_at >= now() - interval '7 days'
    ) as total_delivery_avg_minutes,
    -- cancelled-after-accept / accepted (orders that reached 'accepted' in
    -- the window; numerator = those with a later 'cancelled' event — only
    -- admin or the pre-accept customer path can cancel post-accept, so any
    -- cancel event timestamped at/after the accept event is a real cancel-
    -- after-accept, not a same-order double-count).
    (
      select case when count(*) = 0 then null
        else round((count(*) filter (
          where exists (
            select 1 from cancelled_events c
            where c.order_id = a.order_id and c.first_cancelled_at >= a.accepted_at
          )
        ))::numeric / count(*), 3) end
      from accepted_events a
      where a.accepted_at >= now() - interval '7 days'
    ) as unfinished_order_rate
)
select * from metrics where public.has_role('platform_admin');

revoke all on public.admin_dispatch_metrics from anon;
grant select on public.admin_dispatch_metrics to authenticated;
