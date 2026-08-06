-- ============================================================================
-- MARELE AUDIT 2026-08-03 — MoneySectorAudit #3 (P1)
--
-- The go/no-go KPI "Cota curierului din tarif" was avg(courier_fee_mdl /
-- delivery_fee_mdl) with a 70-75% target — a ratio of two STRUCTURALLY
-- INDEPENDENT amounts: courier_fee is the per-delivery tariff (base + per-km +
-- wait + surcharge), delivery_fee is a flat per-restaurant charge. Their ratio
-- is a function of distance, not of any pay-split policy, so the KPI could read
-- pass or fail by coincidence (e.g. the 6km no-GPS fallback yields >140%). A
-- go/no-go signal that can lie is worse than none.
--
-- Replaced with the platform's DIRECT delivery margin (delivery_fee_mdl -
-- courier_fee_mdl) — a real unit-economics figure — with a defensible floor
-- target (>= 0: delivery pricing at least covers courier cost on average),
-- not a fabricated band. All other 9 KPIs are recreated verbatim from the live
-- 20260731000000 body.
-- ============================================================================
create or replace function public.admin_pilot_go_no_go()
 returns table(kpi text, value_text text, target_text text, status text)
 language plpgsql
 stable security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v numeric; v_ready bigint; v_lost bigint;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  select percentile_cont(0.5) within group (order by k.median_gross_per_shift_14d)
    into v from public.admin_courier_pilot_kpis k where k.median_gross_per_shift_14d is not null;
  return query select 'Brut median / tură (14d)'::text,
    coalesce(round(v)::text || ' MDL', '—'), '600–1000 MDL'::text,
    case when v is null then 'no_data' when v between 600 and 1000 then 'pass' else 'fail' end;

  select percentile_cont(0.5) within group (order by s.gross) into v from (
    select sum(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0)) as gross
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at >= now() - interval '28 days' and o.courier_id is not null
    group by o.courier_id) s;
  return query select 'Brut median / lună (28d)', coalesce(round(v)::text || ' MDL', '—'),
    '~15.000 MDL', case when v is null then 'no_data' when v >= 15000 then 'pass' else 'fail' end;

  -- MoneyAudit #3: platform delivery margin (delivery_fee − courier_fee), replacing
  -- the meaningless courier_fee/delivery_fee ratio. Floor target ≥ 0.
  select round(avg(o.delivery_fee_mdl - o.courier_fee_mdl), 2) into v
  from public.orders o
  where o.status = 'delivered' and o.delivered_at >= now() - interval '14 days'
    and o.courier_fee_mdl is not null;
  return query select 'Marjă platformă / livrare (14d)', coalesce(v::text || ' MDL', '—'), '≥ 0 MDL',
    case when v is null then 'no_data' when v >= 0 then 'pass' else 'fail' end;

  select m.avg_wait_minutes_7d into v from public.admin_wait_metrics m limit 1;
  return query select 'Așteptare la restaurant (7d)', coalesce(v::text || ' min', '—'), '≤5 min',
    case when v is null then 'no_data' when v <= 5 then 'pass' else 'fail' end;

  select m.total_delivery_avg_minutes into v from public.admin_dispatch_metrics m limit 1;
  return query select 'Timp total livrare (7d)', coalesce(round(v)::text || ' min', '—'), '≤35–49 min',
    case when v is null then 'no_data' when v <= 49 then 'pass' else 'fail' end;

  -- 6. buget suprataxă/bonus din brutul curierului (14d) — ținta ≤10%
  select public.admin_pilot_go_no_go_surge_pct() into v;
  return query select 'Buget bonus/vreme (14d)', coalesce(v::text || '%', '—'), '≤10% din brut',
    case when v is null then 'no_data' when v <= 10 then 'pass' else 'fail' end;

  select round(avg(k.satisfaction_avg_4w), 2) into v
  from public.admin_courier_pilot_kpis k where k.satisfaction_responses_4w > 0;
  return query select 'Satisfacție curieri (4w)', coalesce(v::text || '/5', '—'), '≥4,5/5',
    case when v is null then 'no_data' when v >= 4.5 then 'pass' else 'fail' end;

  select count(*) into v_ready from public.orders o
  where o.created_at >= now() - interval '7 days' and o.order_type = 'standard'
    and exists (select 1 from public.delivery_status_events e
                where e.order_id = o.id and e.status = 'ready_for_pickup');
  select count(*) into v_lost from public.orders o
  where o.created_at >= now() - interval '7 days' and o.order_type = 'standard'
    and o.status = 'cancelled' and o.courier_id is null
    and exists (select 1 from public.delivery_status_events e
                where e.order_id = o.id and e.status = 'ready_for_pickup');
  return query select 'Comenzi neasignate (7d)',
    case when v_ready = 0 then '—' else round(100.0 * v_lost / v_ready, 1)::text || '%' end,
    '<2%', case when v_ready = 0 then 'no_data' when 100.0 * v_lost / v_ready < 2 then 'pass' else 'fail' end;

  select round(avg(s.km), 1) into v from (
    select sum(public.haversine_km(r.lat, r.lng, a.lat, a.lng)) as km
    from public.courier_shifts cs
    join public.orders o on o.courier_id = cs.courier_id and o.status = 'delivered'
      and o.delivered_at >= cs.started_at and o.delivered_at < cs.ended_at
    join public.restaurants r on r.id = o.restaurant_id
    join public.addresses a on a.id = o.delivery_address_id
    where cs.ended_at is not null and cs.ended_at >= now() - interval '14 days'
      and r.lat is not null and a.lat is not null
    group by cs.id) s;
  return query select 'Km / tură (14d, §9 Q3)', coalesce(v::text || ' km', '—'),
    'instrument — publică cifra', case when v is null then 'no_data' else 'info' end;

  select round(avg(s.mins), 0) into v from (
    select sum(extract(epoch from (o.delivered_at - e.created_at)) / 60) as mins
    from public.courier_shifts cs
    join public.orders o on o.courier_id = cs.courier_id and o.status = 'delivered'
      and o.delivered_at >= cs.started_at and o.delivered_at < cs.ended_at
    join lateral (
      select min(created_at) as created_at from public.delivery_status_events e
      where e.order_id = o.id and e.status = 'courier_assigned') e on true
    where cs.ended_at is not null and cs.ended_at >= now() - interval '14 days'
    group by cs.id) s;
  return query select 'Minute în livrare / tură (14d, §9 Q3)', coalesce(v::text || ' min', '—'),
    'instrument — publică cifra', case when v is null then 'no_data' else 'info' end;
end;
$function$;
