-- Order 11 closeout: KPI median filter. admin_courier_pilot_kpis'
-- median_gross_per_shift_14d / avg_orders_per_shift_14d were being dragged
-- toward zero by "blip" shifts — a courier toggles online then offline
-- seconds later with zero deliveries in between (app relaunch, accidental
-- tap, connectivity flap). Those are real shifts (shifts_14d must keep
-- counting them so the operator sees flappy behaviour) but they are NOT
-- signal for "how much does a completed working shift earn" — recreate the
-- view filtering orders_count=0 shifts OUT of the two averaged metrics only,
-- and surface the excluded count explicitly instead of hiding it.
create or replace view public.admin_courier_pilot_kpis
with (security_invoker = on) as
select
  c.id as courier_id,
  c.full_name,
  c.is_active,
  -- Weekly satisfaction, rolling 4 weeks (target >=4.5, Wolt benchmark 4.57).
  (select round(avg(s.stars)::numeric, 2) from public.courier_satisfaction_surveys s
    where s.courier_id = c.id and s.week_start >= date_trunc('week', now())::date - 28) as satisfaction_avg_4w,
  (select count(*) from public.courier_satisfaction_surveys s
    where s.courier_id = c.id and s.week_start >= date_trunc('week', now())::date - 28) as satisfaction_responses_4w,
  -- Gross earnings per COMPLETED shift, rolling 14 days (target 600-1000 MDL/tura).
  sh.shifts_14d,
  sh.median_gross_per_shift_14d,
  sh.avg_orders_per_shift_14d,
  sh.empty_shifts_14d
from public.couriers c
left join lateral (
  select
    count(*) as shifts_14d,
    count(*) filter (where earn.orders_count = 0) as empty_shifts_14d,
    round(percentile_cont(0.5) within group (
      order by earn.gross_mdl
    ) filter (where earn.orders_count > 0)::numeric, 2) as median_gross_per_shift_14d,
    round(avg(earn.orders_count) filter (where earn.orders_count > 0)::numeric, 1) as avg_orders_per_shift_14d
  from public.courier_shifts cs
  cross join lateral (
    select
      count(o.id) as orders_count,
      coalesce(sum(o.delivery_fee_mdl + coalesce(o.tip_mdl, 0)), 0) as gross_mdl
    from public.orders o
    where o.courier_id = cs.courier_id and o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at >= cs.started_at and o.delivered_at < cs.ended_at
  ) earn
  where cs.courier_id = c.id and cs.ended_at is not null and cs.ended_at >= now() - interval '14 days'
) sh on true;

revoke all on public.admin_courier_pilot_kpis from anon;
grant select on public.admin_courier_pilot_kpis to authenticated;
