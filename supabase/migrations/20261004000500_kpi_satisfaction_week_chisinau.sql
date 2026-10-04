-- admin_courier_pilot_kpis: the 4-week satisfaction window was floored on the UTC week while the
-- survey keys are Chisinau Mondays since 20261004000200, so on Monday 00:00-02:59 Chisinau time
-- the window held one extra old week (money/time verifier, 2026-10-04). Live definition
-- (pg_get_viewdef) + ONE delta in both satisfaction subqueries; options and grants unchanged.
create or replace view public.admin_courier_pilot_kpis with (security_invoker = on) as
 SELECT courier_id,
    full_name,
    is_active,
    satisfaction_avg_4w,
    satisfaction_responses_4w,
    shifts_14d,
    median_gross_per_shift_14d,
    avg_orders_per_shift_14d,
    empty_shifts_14d
   FROM ( SELECT c.id AS courier_id,
            c.full_name,
            c.is_active,
            ( SELECT round(avg(s.stars), 2) AS round
                   FROM courier_satisfaction_surveys s
                  WHERE s.courier_id = c.id AND s.week_start >= (date_trunc('week'::text, now() at time zone 'Europe/Chisinau')::date - 28)) AS satisfaction_avg_4w,
            ( SELECT count(*) AS count
                   FROM courier_satisfaction_surveys s
                  WHERE s.courier_id = c.id AND s.week_start >= (date_trunc('week'::text, now() at time zone 'Europe/Chisinau')::date - 28)) AS satisfaction_responses_4w,
            sh.shifts_14d,
            sh.median_gross_per_shift_14d,
            sh.avg_orders_per_shift_14d,
            sh.empty_shifts_14d
           FROM couriers c
             LEFT JOIN LATERAL ( SELECT count(*) AS shifts_14d,
                    count(*) FILTER (WHERE earn.orders_count = 0) AS empty_shifts_14d,
                    round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (earn.gross_mdl::double precision)) FILTER (WHERE earn.orders_count > 0)::numeric, 2) AS median_gross_per_shift_14d,
                    round(avg(earn.orders_count) FILTER (WHERE earn.orders_count > 0), 1) AS avg_orders_per_shift_14d
                   FROM courier_shifts cs
                     CROSS JOIN LATERAL ( SELECT count(o.id) AS orders_count,
                            COALESCE(sum(COALESCE(o.courier_fee_mdl, o.delivery_fee_mdl) + COALESCE(o.tip_mdl, 0::numeric)), 0::numeric) AS gross_mdl
                           FROM orders o
                          WHERE o.courier_id = cs.courier_id AND o.status = 'delivered'::text AND o.payment_status = 'paid'::text AND o.delivered_at >= cs.started_at AND o.delivered_at < cs.ended_at) earn
                  WHERE cs.courier_id = c.id AND cs.ended_at IS NOT NULL AND cs.ended_at >= (now() - '14 days'::interval)) sh ON true) sub
  WHERE has_role('platform_admin'::text);
