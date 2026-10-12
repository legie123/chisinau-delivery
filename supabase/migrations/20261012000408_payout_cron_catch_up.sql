-- The weekly payout run catches up (red-team finding on 93e51df). generate_weekly_payouts paid ONLY
-- the previous Mon-Sun, so a week whose run was missed (cron down, job failed — and pg_cron history
-- is purged after 3 days) or a cash order marked paid after its week's run was never paid.
-- Now: every past Chisinau week (before the current one) that has a delivered + paid order not yet
-- in payout_orders for its restaurant or its courier is generated in its own week, oldest first, then
-- the previous week (so adjustments with no order still get a run). Idempotent: an order already in
-- payout_orders is never paid again, so a rerun creates nothing.
-- Recreated from the LIVE body (20261012000401) with that one delta; signature and grants unchanged.
-- Rollback: re-apply the 20261012000401 definition of generate_weekly_payouts.

create or replace function public.generate_weekly_payouts(p_now timestamptz default now())
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '60s'
as $function$
declare
  v_this_monday date := date_trunc('week', (p_now at time zone 'Europe/Chisinau')::date)::date;
  v_week date;
  v_n int := 0;
begin
  for v_week in
    select distinct date_trunc('week', (o.delivered_at at time zone 'Europe/Chisinau')::date)::date
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid' and o.delivered_at is not null
      and (o.delivered_at at time zone 'Europe/Chisinau')::date < v_this_monday
      and (not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant')
           or (o.courier_id is not null
               and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier')))
    order by 1
  loop
    v_n := v_n + public.generate_payouts_internal(v_week, v_week + 6);
  end loop;
  return v_n + public.generate_payouts_internal(v_this_monday - 7, v_this_monday - 1);
end; $function$;

revoke all on function public.generate_weekly_payouts(timestamptz) from public, anon, authenticated;
