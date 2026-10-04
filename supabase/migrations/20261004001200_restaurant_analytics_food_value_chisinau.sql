-- Partner analytics ("Venit pe zile", the hour-of-day chart) disagreed with the earnings page and the
-- payouts for the same day: the revenue was sum(total_mdl) — delivery fee and courier tip included,
-- money the restaurant never receives (13.695 vs 13.060 MDL measured) — and the day / hour buckets
-- were UTC, shifting the hour chart by 2-3 h (cross-app E2E audit, 2026-10-04). Live definitions
-- (pg_get_viewdef) + deltas: revenue = the food value payouts use (standard: subtotal; catering:
-- total - fee - tip) and Chisinau time for days, the 14-day grid and hours. security_invoker and
-- grants are kept by CREATE OR REPLACE; columns unchanged.
create or replace view public.restaurant_analytics_daily with (security_invoker = on) as
 WITH accessible AS (
         SELECT r.id AS restaurant_id
           FROM restaurants r
          WHERE has_restaurant_access(r.id)
        ), days AS (
         SELECT generate_series((now() AT TIME ZONE 'Europe/Chisinau')::date - 13, (now() AT TIME ZONE 'Europe/Chisinau')::date, '1 day'::interval)::date AS day
        ), grid AS (
         SELECT a_1.restaurant_id,
            d.day
           FROM accessible a_1
             CROSS JOIN days d
        ), agg AS (
         SELECT o.restaurant_id,
            (o.created_at AT TIME ZONE 'Europe/Chisinau')::date AS day,
            count(*) AS orders_count,
            sum(CASE WHEN o.order_type = 'standard'::text THEN o.subtotal_mdl ELSE GREATEST(o.total_mdl - o.delivery_fee_mdl - COALESCE(o.tip_mdl, 0::numeric), 0::numeric) END) AS revenue_mdl
           FROM orders o
          WHERE o.status = 'delivered'::text AND o.created_at >= (now() - '14 days'::interval) AND (o.restaurant_id IN ( SELECT accessible.restaurant_id
                   FROM accessible))
          GROUP BY o.restaurant_id, ((o.created_at AT TIME ZONE 'Europe/Chisinau')::date)
        )
 SELECT g.restaurant_id,
    g.day,
    COALESCE(a.orders_count, 0::bigint) AS orders_count,
    COALESCE(a.revenue_mdl, 0::numeric)::numeric(10,2) AS revenue_mdl
   FROM grid g
     LEFT JOIN agg a ON a.restaurant_id = g.restaurant_id AND a.day = g.day;

create or replace view public.restaurant_analytics_hourly with (security_invoker = on) as
 WITH accessible AS (
         SELECT r.id AS restaurant_id
           FROM restaurants r
          WHERE has_restaurant_access(r.id)
        ), hours AS (
         SELECT generate_series(0, 23) AS hour_of_day
        ), grid AS (
         SELECT a_1.restaurant_id,
            h.hour_of_day
           FROM accessible a_1
             CROSS JOIN hours h
        ), agg AS (
         SELECT o.restaurant_id,
            EXTRACT(hour FROM (o.created_at AT TIME ZONE 'Europe/Chisinau'))::integer AS hour_of_day,
            count(*) AS orders_count,
            sum(CASE WHEN o.order_type = 'standard'::text THEN o.subtotal_mdl ELSE GREATEST(o.total_mdl - o.delivery_fee_mdl - COALESCE(o.tip_mdl, 0::numeric), 0::numeric) END) AS revenue_mdl
           FROM orders o
          WHERE o.status = 'delivered'::text AND o.created_at >= (now() - '14 days'::interval) AND (o.restaurant_id IN ( SELECT accessible.restaurant_id
                   FROM accessible))
          GROUP BY o.restaurant_id, (EXTRACT(hour FROM (o.created_at AT TIME ZONE 'Europe/Chisinau'))::integer)
        )
 SELECT g.restaurant_id,
    g.hour_of_day,
    COALESCE(a.orders_count, 0::bigint) AS orders_count,
    COALESCE(a.revenue_mdl, 0::numeric)::numeric(10,2) AS revenue_mdl
   FROM grid g
     LEFT JOIN agg a ON a.restaurant_id = g.restaurant_id AND a.hour_of_day = g.hour_of_day;
