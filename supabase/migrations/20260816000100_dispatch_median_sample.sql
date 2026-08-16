-- R9 (2026-08-16) — al doilea val adversarial pe suprafata ADMIN, ultima
-- nematurata din lista lasata deschisa de V11 in .bucla/issues.md.
--
-- Ce s-a masurat, pe DB-ul viu, inainte de a scrie o linie: cele sase livrari
-- din fereastra de 7 zile aveau duratele placed→delivered
--   10130,2 · 7071,7 · 15,1 · 7,2 · 5,4 · 0,0  (minute)
-- Patru sub un sfert de ora, doua ramase zile in conducta. `admin_dispatch_metrics`
-- publica DOAR media aritmetica (2871,6 min), iar `admin_pilot_go_no_go` o
-- compara cu tinta „≤35–49 min" si scria FAIL pe pagina pe care se ia decizia de
-- lansare a pilotului. Mediana acelorasi sase randuri e 11,15 min, adica PASS:
-- doua verdicte opuse din aceleasi date, dupa cum alegi masura centrala.
--
-- Regula casei exista deja de doua ori si nu ajunsese aici:
--   · `get_prep_estimates` nu publica o statistica sub 5 observatii;
--   · `20260727001500` a scos turele-scanteie din mediana KPI-urilor de curier
--     PASTRAND numarul lor vizibil (`empty_shifts_14d`), in loc sa-l ascunda.
-- Aplicate aici: se judeca mediana, se publica esantionul, iar media ramane
-- scrisa langa ea cand difera material (≥1,5×). Nicio coloana nu se sterge —
-- o medie disparuta ar ascunde exact cozile lungi pe care le-am gasit.
--
-- Corpurile de mai jos sunt luate din catalogul VIU (`pg_get_viewdef` /
-- `pg_proc.prosrc`), nu retiparite din migratiile vechi, si modificate cu un
-- singur delta fiecare — lectia platita in `20260815000100`.

-- 1. View-ul: doua coloane aditive (mediana + esantionul). DROP+CREATE fiindca
--    Postgres nu accepta coloane noi intr-un CREATE OR REPLACE VIEW la mijlocul
--    listei; nu exista dependenti in catalog (verificat cu pg_depend).
drop view if exists public.admin_dispatch_metrics;
create view public.admin_dispatch_metrics with (security_invoker = on) as
 WITH ready_events AS (
         SELECT delivery_status_events.order_id,
            min(delivery_status_events.created_at) AS ready_at
           FROM delivery_status_events
          WHERE delivery_status_events.status = 'ready_for_pickup'::text
          GROUP BY delivery_status_events.order_id
        ), assigned_events AS (
         SELECT delivery_status_events.order_id,
            min(delivery_status_events.created_at) AS assigned_at
           FROM delivery_status_events
          WHERE delivery_status_events.status = 'courier_assigned'::text
          GROUP BY delivery_status_events.order_id
        ), picked_events AS (
         SELECT delivery_status_events.order_id,
            min(delivery_status_events.created_at) AS picked_at
           FROM delivery_status_events
          WHERE delivery_status_events.status = 'picked_up'::text
          GROUP BY delivery_status_events.order_id
        ), accepted_events AS (
         SELECT delivery_status_events.order_id,
            min(delivery_status_events.created_at) AS accepted_at
           FROM delivery_status_events
          WHERE delivery_status_events.status = 'accepted'::text
          GROUP BY delivery_status_events.order_id
        ), cancelled_events AS (
         SELECT delivery_status_events.order_id,
            min(delivery_status_events.created_at) AS first_cancelled_at
           FROM delivery_status_events
          WHERE delivery_status_events.status = 'cancelled'::text
          GROUP BY delivery_status_events.order_id
        ), metrics AS (
         SELECT ( SELECT round(avg(EXTRACT(epoch FROM a.assigned_at - r.ready_at)))::integer AS round
                   FROM ready_events r
                     JOIN assigned_events a ON a.order_id = r.order_id AND a.assigned_at >= r.ready_at
                  WHERE r.ready_at >= (now() - '7 days'::interval)) AS time_to_assign_avg_seconds,
            ( SELECT
                        CASE
                            WHEN count(*) = 0 THEN NULL::numeric
                            ELSE round(count(*) FILTER (WHERE dispatch_offers.status = 'accepted'::text)::numeric / count(*)::numeric, 3)
                        END AS round
                   FROM dispatch_offers
                  WHERE dispatch_offers.wave = 1 AND dispatch_offers.created_at >= (now() - '7 days'::interval)) AS first_offer_acceptance_rate,
            ( SELECT round(avg(mw.max_wave), 2) AS round
                   FROM ( SELECT dispatch_offers.order_id,
                            max(dispatch_offers.wave) AS max_wave
                           FROM dispatch_offers
                          WHERE dispatch_offers.created_at >= (now() - '7 days'::interval)
                          GROUP BY dispatch_offers.order_id) mw) AS decline_cascade_depth_avg,
            ( SELECT round(avg(EXTRACT(epoch FROM p.picked_at - r.ready_at)))::integer AS round
                   FROM ready_events r
                     JOIN picked_events p ON p.order_id = r.order_id AND p.picked_at >= r.ready_at
                  WHERE r.ready_at >= (now() - '7 days'::interval)) AS restaurant_handover_avg_seconds,
            ( SELECT round(avg(EXTRACT(epoch FROM o.delivered_at - o.created_at) / 60::numeric), 1) AS round
                   FROM orders o
                  WHERE o.status = 'delivered'::text AND o.delivered_at IS NOT NULL AND o.delivered_at >= (now() - '7 days'::interval)) AS total_delivery_avg_minutes,
            ( SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM o.delivered_at - o.created_at) / 60::numeric)::numeric, 1)
                   FROM orders o
                  WHERE o.status = 'delivered'::text AND o.delivered_at IS NOT NULL AND o.delivered_at >= (now() - '7 days'::interval)) AS total_delivery_median_minutes,
            ( SELECT count(*)
                   FROM orders o
                  WHERE o.status = 'delivered'::text AND o.delivered_at IS NOT NULL AND o.delivered_at >= (now() - '7 days'::interval)) AS total_delivery_orders,
            ( SELECT
                        CASE
                            WHEN count(*) = 0 THEN NULL::numeric
                            ELSE round(count(*) FILTER (WHERE (EXISTS ( SELECT 1
                               FROM cancelled_events c
                              WHERE c.order_id = a.order_id AND c.first_cancelled_at >= a.accepted_at)))::numeric / count(*)::numeric, 3)
                        END AS round
                   FROM accepted_events a
                  WHERE a.accepted_at >= (now() - '7 days'::interval)) AS unfinished_order_rate
        )
 SELECT time_to_assign_avg_seconds,
    first_offer_acceptance_rate,
    decline_cascade_depth_avg,
    restaurant_handover_avg_seconds,
    total_delivery_avg_minutes,
    total_delivery_median_minutes,
    total_delivery_orders,
    unfinished_order_rate
   FROM metrics
  WHERE has_role('platform_admin'::text);

grant select on public.admin_dispatch_metrics to authenticated;

-- 2. Go/no-go: acelasi corp viu, cu UN singur bloc schimbat (Timp total livrare).
create or replace function public.admin_pilot_go_no_go()
returns table (kpi text, value_text text, target_text text, status text)
language plpgsql
stable
security definer
set search_path = public, auth
as $fn$
declare
  v numeric; v_avg numeric; v_n bigint; v_ready bigint; v_lost bigint;
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

  -- R9: mediana, nu media, si NICIUN verdict sub pragul casei de 5 observatii.
  -- Media ramane citita ca sa poata fi scrisa in celula: o coada lunga e
  -- informatie operationala, nu zgomot de eliminat.
  select m.total_delivery_median_minutes, m.total_delivery_avg_minutes, m.total_delivery_orders
    into v, v_avg, v_n from public.admin_dispatch_metrics m limit 1;
  return query select 'Timp total livrare (7d)',
    case
      when coalesce(v_n, 0) < 5 or v is null
        then '— · ' || coalesce(v_n, 0)::text || ' livrări (prag 5)'
      when v_avg is not null and v_avg >= v * 1.5
        then round(v)::text || ' min median · ' || v_n::text || ' livrări · media ' || round(v_avg)::text || ' min'
      else round(v)::text || ' min median · ' || v_n::text || ' livrări'
    end,
    '≤35–49 min',
    case when coalesce(v_n, 0) < 5 or v is null then 'no_data' when v <= 49 then 'pass' else 'fail' end;

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

$fn$;

revoke all on function public.admin_pilot_go_no_go() from public;
grant execute on function public.admin_pilot_go_no_go() to authenticated;
