-- ============================================================================
-- MARELE AUDIT 2026-08-03 — MoneySectorAudit #1 (P0)
--
-- pricing_config is versioned + immutable + published (/cum-functioneaza reads
-- public_pricing_history), but admin_generate_payouts read
-- platform_settings.{courier,restaurant}_commission_pct — a MUTABLE cache that
-- set_pricing_config overwrites on every change. admin_generate_payouts usually
-- runs RETROACTIVELY over a past period; if the commission changed between an
-- order's delivery and payout generation, the WHOLE batch took the CURRENT
-- commission, not the one in effect at delivery — for restaurants AND couriers.
-- The public history then disagreed with what was actually charged.
-- (delivery_fee_mdl is unaffected — it's write-once stamped per order.)
--
-- Fix: commission is now read per order from the pricing_config version in
-- effect at that order's delivered_at (temporal lookup — also correct for
-- already-delivered historical orders, and it matches the published history).
-- The aggregate payout.commission_mdl is the SUM of the per-order commissions,
-- so it stays exactly reconcilable with the payout_orders lines even when a
-- pay period spans a version boundary. platform_settings stays only as a
-- never-hit coalesce fallback (the seed version is effective 2026-01-01, before
-- any real order). clawback is untouched: it already reverses the stored
-- payout_orders values, so it inherits the correct commission automatically.
-- ============================================================================

-- Version in effect at an arbitrary instant (mirror of current_pricing_config,
-- which is pinned to now()).
create or replace function public.pricing_config_at(p_ts timestamptz)
returns public.pricing_config
language sql
stable
security definer
set search_path to 'public'
as $function$
  select * from public.pricing_config
  where effective_from <= coalesce(p_ts, now())
  order by effective_from desc
  limit 1;
$function$;

create or replace function public.admin_generate_payouts(p_start date, p_end date)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_c record; v_settings public.platform_settings%rowtype; v_n int := 0;
        v_payout_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
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
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
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
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
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
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
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
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier');
    v_n := v_n + 1;
  end loop;

  return v_n;
end; $function$;

revoke all on function public.pricing_config_at(timestamptz) from public, anon;
grant execute on function public.pricing_config_at(timestamptz) to authenticated, service_role;
