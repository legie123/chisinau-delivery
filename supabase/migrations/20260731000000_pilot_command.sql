-- Faza 5 — Pilot Command Center (audit §8 Faza 5 Verify + Faza 6 Verify):
-- "fiecare declanșator are un query care rulează în dashboard și un pass/fail
-- vizibil". Două funcții SECURITY DEFINER, admin-only, READ-ONLY — niciun prag
-- nu acționează automat nimic (om în buclă pe orice decizie).
--
-- Include instrumentarea §9 Q3 (câștigul efectiv real): timp online, minute în
-- livrare, km parcurși și brut per tură — cifrele pe care nimeni în MD nu le
-- publică. Pragul trigger-ului de matching global vine din simulatorul propriu
-- (docs/plan/SIMULATOR-RAPORT-2026-07-31.md): câștig >10% abia la ~48
-- livrări/curier/zi; armăm conservator la 24 susținut.

create or replace function public.admin_pilot_go_no_go()
returns table (kpi text, value_text text, target_text text, status text)
language plpgsql stable security definer
set search_path = public, auth
as $$
declare
  v numeric; v2 numeric; v_ready bigint; v_lost bigint;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  -- 1. brut median MDL / tură completă (14d) — ținta 600-1000 (rabota.md/999.md)
  select percentile_cont(0.5) within group (order by k.median_gross_per_shift_14d)
    into v from public.admin_courier_pilot_kpis k where k.median_gross_per_shift_14d is not null;
  return query select 'Brut median / tură (14d)'::text,
    coalesce(round(v)::text || ' MDL', '—'), '600–1000 MDL'::text,
    case when v is null then 'no_data' when v between 600 and 1000 then 'pass' else 'fail' end;

  -- 2. brut median MDL / lună per curier activ (28d) — ancora ~15.000 (jobber.md)
  select percentile_cont(0.5) within group (order by s.gross) into v from (
    select sum(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0)) as gross
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at >= now() - interval '28 days' and o.courier_id is not null
    group by o.courier_id) s;
  return query select 'Brut median / lună (28d)', coalesce(round(v)::text || ' MDL', '—'),
    '~15.000 MDL', case when v is null then 'no_data' when v >= 15000 then 'pass' else 'fail' end;

  -- 3. cota curierului din tariful de livrare — ținta 70-75% (Bolt "up to 75%")
  select round(avg(o.courier_fee_mdl / nullif(o.delivery_fee_mdl, 0)) * 100, 1) into v
  from public.orders o
  where o.status = 'delivered' and o.delivered_at >= now() - interval '14 days'
    and o.courier_fee_mdl is not null and o.delivery_fee_mdl > 0;
  return query select 'Cota curierului din tarif', coalesce(v::text || '%', '—'), '70–75%',
    case when v is null then 'no_data' when v between 70 and 75 then 'pass' else 'fail' end;

  -- 4. așteptare medie la restaurant (7d, ceasul de sosire) — ținta ≤5 min (Glovo)
  select m.avg_wait_minutes_7d into v from public.admin_wait_metrics m limit 1;
  return query select 'Așteptare la restaurant (7d)', coalesce(v::text || ' min', '—'), '≤5 min',
    case when v is null then 'no_data' when v <= 5 then 'pass' else 'fail' end;

  -- 5. timp total de livrare (7d) — banda 35-49 min (Wolt ~35, Straus ~49)
  select m.total_delivery_avg_minutes into v from public.admin_dispatch_metrics m limit 1;
  return query select 'Timp total livrare (7d)', coalesce(round(v)::text || ' min', '—'), '≤35–49 min',
    case when v is null then 'no_data' when v <= 49 then 'pass' else 'fail' end;

  -- 6. buget bonus/vreme din brutul curierului — ținta ≤10% (n/a până la suprataxă)
  return query select 'Buget bonus/vreme', '—'::text, '≤10% din brut', 'no_data'::text;

  -- 7. satisfacție curieri (4w) — ținta ≥4,5/5 (benchmark Wolt 4,57)
  select round(avg(k.satisfaction_avg_4w), 2) into v
  from public.admin_courier_pilot_kpis k where k.satisfaction_responses_4w > 0;
  return query select 'Satisfacție curieri (4w)', coalesce(v::text || '/5', '—'), '≥4,5/5',
    case when v is null then 'no_data' when v >= 4.5 then 'pass' else 'fail' end;

  -- 8. comenzi neasignate (7d): au ajuns ready dar au murit fără curier — ținta <2%
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

  -- 9. §9 Q3 — km parcurși / tură (14d, haversine restaurant→client per livrare)
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

  -- 10. §9 Q3 — minute în livrare / tură (14d, asignare→livrat)
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
$$;
revoke execute on function public.admin_pilot_go_no_go() from public, anon;
grant execute on function public.admin_pilot_go_no_go() to authenticated;

create or replace function public.admin_scaling_triggers()
returns table (trigger_name text, current_value text, threshold_text text, armed boolean)
language plpgsql stable security definer
set search_path = public, auth
as $$
declare v numeric;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  -- 1. Batching nivel 1 — % ferestre de vârf (15 min, 12-14 & 18-21, 7d) cu ≥2
  --    comenzi devenite ready în aceeași fereastră; prag audit >20% (FOODMATCH)
  select round(100.0 * count(*) filter (where n >= 2) / nullif(count(*), 0), 1) into v from (
    select date_trunc('hour', e.created_at) + floor(extract(minute from e.created_at) / 15) * interval '15 min' as w,
           count(*) as n
    from public.delivery_status_events e
    where e.status = 'ready_for_pickup' and e.created_at >= now() - interval '7 days'
      and extract(hour from e.created_at) in (12, 13, 18, 19, 20)
    group by 1) b;
  return query select 'Batching nivel 1'::text, coalesce(v::text || '% ferestre', '—'),
    '>20% ferestre de vârf cu ≥2 comenzi'::text, coalesce(v > 20, false);

  -- 2. Matching global — livrări/curier-activ/zi susținut (7d); simulatorul
  --    propriu arată câștig >10% abia la ~48; armăm conservator la 24
  select round(count(*)::numeric / nullif(count(distinct o.courier_id), 0) / 7, 1) into v
  from public.orders o
  where o.status = 'delivered' and o.delivered_at >= now() - interval '7 days';
  return query select 'Matching global (ungar)', coalesce(v::text || ' livrări/curier/zi', '—'),
    '≥24 susținut (simulator: câștig >10% la ~48)', coalesce(v >= 24, false);

  -- 3. App nativ curier (Expo) — vârf de curieri online simultan (7d) vs 30
  select max(cnt) into v from (
    select sum(delta) over (order by t rows unbounded preceding) as cnt from (
      select started_at as t, 1 as delta from public.courier_shifts
        where started_at >= now() - interval '7 days'
      union all
      select coalesce(ended_at, now()), -1 from public.courier_shifts
        where started_at >= now() - interval '7 days') ev) run;
  return query select 'App nativ curier (Expo)', coalesce(v::text || ' online simultan', '—'),
    '>30–50 curieri simultan', coalesce(v > 30, false);

  -- 4. Portal separat restaurant — parteneri activi vs 30 (Glovo: anul 4)
  select count(*) into v from public.restaurants where is_active;
  return query select 'Portal restaurant separat', v::text || ' parteneri activi',
    '>30 parteneri (sau primul multi-locație)', coalesce(v > 30, false);
end;
$$;
revoke execute on function public.admin_scaling_triggers() from public, anon;
grant execute on function public.admin_scaling_triggers() to authenticated;
