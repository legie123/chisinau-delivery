-- RESTAURANT ANALYTICS DATA LAYER — histogram-ready data for partner dashboards
-- + a public "popular times" surface, in the shape dataviz components can bind
-- to directly (zero-filled buckets, no gaps a chart would have to paper over).
--
-- Three PARTNER-SCOPED views (security_invoker=on, has_restaurant_access-scoped
-- like restaurant_wait_kpis / admin_dispatch_metrics precedent — RLS on the
-- underlying `orders`/`order_items` already enforces the same boundary via
-- orders_partner_scope, but the explicit `accessible` CTE additionally builds
-- the zero-fill grid scoped to restaurants the caller may see, so a partner
-- never gets a bucket row for a restaurant_id they have no access to even
-- when that restaurant has zero matching orders):
--   - restaurant_analytics_hourly — last 14d delivered orders bucketed by
--     hour-of-day (0-23), zero-filled per restaurant.
--   - restaurant_analytics_daily  — last 14 calendar days, zero-filled.
--   - restaurant_top_items        — last 28d, top 8 menu items by qty per
--     restaurant (item_name_snapshot, not a menu_items join — survives a
--     renamed/deleted item exactly like the order_items table already does).
--
-- Two AGGREGATE-ONLY SECURITY DEFINER RPCs, granted to anon + authenticated
-- (render on the public restaurant page, no account needed — same reach
-- pattern as get_prep_estimates/public_pricing_history):
--   - popular_hours(p_restaurant_id)   — Google-"popular times" style: 24
--     zero-filled hour buckets, last 28d delivered orders, raw count +
--     0-100 intensity normalized against that restaurant's own busiest hour.
--   - rating_breakdown(p_restaurant_id) — 5 zero-filled star buckets + total.
-- Both return ONLY counts (no customer_id/comment/order_id) — no PII surface,
-- safe for an unauthenticated caller by construction, not by RLS.

-- ---------------------------------------------------------------------------
-- restaurant_analytics_hourly — 24 rows per accessible restaurant.
-- ---------------------------------------------------------------------------
create or replace view public.restaurant_analytics_hourly
with (security_invoker = on) as
with accessible as (
  select r.id as restaurant_id
  from public.restaurants r
  where public.has_restaurant_access(r.id)
),
hours as (
  select generate_series(0, 23) as hour_of_day
),
grid as (
  select a.restaurant_id, h.hour_of_day
  from accessible a
  cross join hours h
),
agg as (
  select
    o.restaurant_id,
    extract(hour from o.created_at)::int as hour_of_day,
    count(*) as orders_count,
    sum(o.total_mdl) as revenue_mdl
  from public.orders o
  where o.status = 'delivered'
    and o.created_at >= now() - interval '14 days'
    and o.restaurant_id in (select restaurant_id from accessible)
  group by o.restaurant_id, extract(hour from o.created_at)::int
)
select
  g.restaurant_id,
  g.hour_of_day,
  coalesce(a.orders_count, 0) as orders_count,
  coalesce(a.revenue_mdl, 0)::numeric(10, 2) as revenue_mdl
from grid g
left join agg a on a.restaurant_id = g.restaurant_id and a.hour_of_day = g.hour_of_day;

revoke all on public.restaurant_analytics_hourly from anon;
grant select on public.restaurant_analytics_hourly to authenticated;

-- ---------------------------------------------------------------------------
-- restaurant_analytics_daily — last 14 calendar days, zero-filled.
-- ---------------------------------------------------------------------------
create or replace view public.restaurant_analytics_daily
with (security_invoker = on) as
with accessible as (
  select r.id as restaurant_id
  from public.restaurants r
  where public.has_restaurant_access(r.id)
),
days as (
  select generate_series(current_date - interval '13 days', current_date, interval '1 day')::date as day
),
grid as (
  select a.restaurant_id, d.day
  from accessible a
  cross join days d
),
agg as (
  select
    o.restaurant_id,
    o.created_at::date as day,
    count(*) as orders_count,
    sum(o.total_mdl) as revenue_mdl
  from public.orders o
  where o.status = 'delivered'
    and o.created_at >= now() - interval '14 days'
    and o.restaurant_id in (select restaurant_id from accessible)
  group by o.restaurant_id, o.created_at::date
)
select
  g.restaurant_id,
  g.day,
  coalesce(a.orders_count, 0) as orders_count,
  coalesce(a.revenue_mdl, 0)::numeric(10, 2) as revenue_mdl
from grid g
left join agg a on a.restaurant_id = g.restaurant_id and a.day = g.day;

revoke all on public.restaurant_analytics_daily from anon;
grant select on public.restaurant_analytics_daily to authenticated;

-- ---------------------------------------------------------------------------
-- restaurant_top_items — last 28d, top 8 items by qty per restaurant. No
-- zero-fill (there is no fixed universe of "all possible items" to grid over).
-- ---------------------------------------------------------------------------
create or replace view public.restaurant_top_items
with (security_invoker = on) as
with accessible as (
  select r.id as restaurant_id
  from public.restaurants r
  where public.has_restaurant_access(r.id)
),
agg as (
  select
    o.restaurant_id,
    oi.item_name_snapshot as item_name,
    sum(oi.quantity) as qty,
    sum(oi.line_total_mdl) as revenue_mdl
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.status = 'delivered'
    and o.created_at >= now() - interval '28 days'
    and o.restaurant_id in (select restaurant_id from accessible)
  group by o.restaurant_id, oi.item_name_snapshot
),
ranked as (
  select
    agg.*,
    row_number() over (partition by restaurant_id order by qty desc, revenue_mdl desc) as rnk
  from agg
)
select
  restaurant_id,
  item_name,
  qty,
  revenue_mdl::numeric(10, 2) as revenue_mdl
from ranked
where rnk <= 8;

revoke all on public.restaurant_top_items from anon;
grant select on public.restaurant_top_items to authenticated;

-- ---------------------------------------------------------------------------
-- popular_hours(p_restaurant_id) — anon-reachable, aggregate-only. 24
-- zero-filled hour buckets, last 28d delivered orders for that ONE
-- restaurant, raw count + 0-100 intensity normalized against its own busiest
-- hour (greatest(...,1) below only guards the division when every bucket is
-- zero — the numerator is 0 in that case too, so intensity comes out 0, not
-- a bogus 100).
-- ---------------------------------------------------------------------------
create or replace function public.popular_hours(p_restaurant_id uuid)
returns table (
  hour_of_day int,
  orders_count bigint,
  intensity_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with hours as (
    select generate_series(0, 23) as hour_of_day
  ),
  agg as (
    select
      extract(hour from o.created_at)::int as hour_of_day,
      count(*) as orders_count
    from public.orders o
    where o.restaurant_id = p_restaurant_id
      and o.status = 'delivered'
      and o.created_at >= now() - interval '28 days'
    group by extract(hour from o.created_at)::int
  ),
  joined as (
    select h.hour_of_day, coalesce(a.orders_count, 0) as orders_count
    from hours h
    left join agg a on a.hour_of_day = h.hour_of_day
  ),
  peak as (
    select greatest(max(orders_count), 1) as peak_count from joined
  )
  select
    j.hour_of_day,
    j.orders_count,
    round(100.0 * j.orders_count / (select peak_count from peak), 1) as intensity_pct
  from joined j
  order by j.hour_of_day;
$$;
revoke all on function public.popular_hours(uuid) from public;
grant execute on function public.popular_hours(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- rating_breakdown(p_restaurant_id) — anon-reachable, aggregate-only. 5
-- zero-filled star buckets (1-5) + total_ratings repeated on every row (so a
-- single-row destructure or a full table read both work for the caller).
-- Only restaurant-target ratings (target_type='restaurant') — courier ratings
-- on the same order_id/customer are a different target, out of scope here.
-- ---------------------------------------------------------------------------
create or replace function public.rating_breakdown(p_restaurant_id uuid)
returns table (
  stars int,
  rating_count bigint,
  total_ratings bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with buckets as (
    select generate_series(1, 5) as stars
  ),
  agg as (
    select r.stars, count(*) as cnt
    from public.ratings r
    where r.restaurant_id = p_restaurant_id
      and r.target_type = 'restaurant'
    group by r.stars
  ),
  total as (
    select coalesce(sum(cnt), 0) as t from agg
  )
  select
    b.stars,
    coalesce(a.cnt, 0) as rating_count,
    (select t from total) as total_ratings
  from buckets b
  left join agg a on a.stars = b.stars
  order by b.stars;
$$;
revoke all on function public.rating_breakdown(uuid) from public;
grant execute on function public.rating_breakdown(uuid) to anon, authenticated;
