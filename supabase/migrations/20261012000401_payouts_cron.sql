-- Weekly payouts run from pg_cron, no JWT, no admin click.
-- admin_generate_payouts checked has_role('platform_admin'), so under pg_cron (auth.uid() null) it
-- raised: nobody got paid unless an admin generated the batch by hand.
-- generate_payouts_internal = the LIVE body of admin_generate_payouts (20261004000600, via
-- 20261008000100) with ONE delta: the role check removed. Not executable by anon/authenticated.
-- admin_generate_payouts becomes a thin role-checked wrapper over it (same advisory lock).
-- generate_weekly_payouts(now) pays the previous Monday-Sunday in Europe/Chisinau (DST-safe: the
-- week is computed on the local date, the per-order filter already uses the Chisinau date).
-- Idempotent: an order already in payout_orders is never paid again; paid payouts stay frozen.

CREATE OR REPLACE FUNCTION public.generate_payouts_internal(p_start date, p_end date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_c record; v_settings public.platform_settings%rowtype; v_n int := 0;
        v_payout_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('admin_generate_payouts'));
  -- kept ONLY as the coalesce fallback below (never hit with the seeded v1 config).
  select * into v_settings from public.platform_settings where id;

  -- ---- restaurants ----
  for v_c in
    select o.restaurant_id as rid, count(*) as cnt, sum(b.gross) as gross, sum(b.commission) as commission
    from public.orders o
    left join lateral public.pricing_config_at(o.delivered_at) pc on true
    cross join lateral (
      select gg as gross,
             round(gg * coalesce(pc.restaurant_commission_pct, v_settings.restaurant_commission_pct) / 100, 2) as commission
      from (select case when o.order_type = 'standard' then o.subtotal_mdl
                        else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end) as x(gg)
    ) b
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and (o.delivered_at at time zone 'Europe/Chisinau')::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant')
    group by o.restaurant_id
  loop
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('restaurant', v_c.rid, p_start, p_end, v_c.cnt, v_c.gross, v_c.commission, v_c.gross - v_c.commission)
    returning id into v_payout_id;

    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
    select v_payout_id, o.id, 'restaurant', b.gross, b.gross - b.commission
    from public.orders o
    left join lateral public.pricing_config_at(o.delivered_at) pc on true
    cross join lateral (
      select gg as gross,
             round(gg * coalesce(pc.restaurant_commission_pct, v_settings.restaurant_commission_pct) / 100, 2) as commission
      from (select case when o.order_type = 'standard' then o.subtotal_mdl
                        else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end) as x(gg)
    ) b
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and (o.delivered_at at time zone 'Europe/Chisinau')::date between p_start and p_end
      and o.restaurant_id = v_c.rid
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant');
    v_n := v_n + 1;
  end loop;

  -- ---- couriers (commission on the fee only, tip passed through) ----
  for v_c in
    select o.courier_id as cid, count(*) as cnt,
           sum(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0)) as gross,
           sum(round(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) * coalesce(pc.courier_commission_pct, v_settings.courier_commission_pct) / 100, 2)) as commission
    from public.orders o
    left join lateral public.pricing_config_at(o.delivered_at) pc on true
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id is not null
      and o.delivered_at is not null and (o.delivered_at at time zone 'Europe/Chisinau')::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier')
    group by o.courier_id
  loop
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('courier', v_c.cid, p_start, p_end, v_c.cnt, v_c.gross, v_c.commission, v_c.gross - v_c.commission)
    returning id into v_payout_id;

    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
    select v_payout_id, o.id, 'courier',
           coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0),
           (coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0))
             - round(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) * coalesce(pc.courier_commission_pct, v_settings.courier_commission_pct) / 100, 2)
    from public.orders o
    left join lateral public.pricing_config_at(o.delivered_at) pc on true
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id = v_c.cid
      and o.delivered_at is not null and (o.delivered_at at time zone 'Europe/Chisinau')::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier');
    v_n := v_n + 1;
  end loop;

  return v_n;
end; $function$

;

revoke all on function public.generate_payouts_internal(date, date) from public, anon, authenticated;

create or replace function public.admin_generate_payouts(p_start date, p_end date)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  return public.generate_payouts_internal(p_start, p_end);
end; $function$;

create or replace function public.generate_weekly_payouts(p_now timestamptz default now())
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_start date := date_trunc('week', (p_now at time zone 'Europe/Chisinau')::date)::date - 7;
begin
  return public.generate_payouts_internal(v_start, v_start + 6);
end; $function$;

revoke all on function public.generate_weekly_payouts(timestamptz) from public, anon, authenticated;
alter function public.generate_payouts_internal(date, date) set statement_timeout = '60s';
alter function public.generate_weekly_payouts(timestamptz) set statement_timeout = '60s';

-- Monday 04:00 UTC = 06:00/07:00 Chisinau: the local week has already turned in both seasons.
select cron.schedule('weekly-payouts', '0 4 * * 1', 'select public.generate_weekly_payouts();');
