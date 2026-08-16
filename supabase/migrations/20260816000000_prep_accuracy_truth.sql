-- V2 buclă de noapte (2026-08-16) — cauza rădăcină a lui „Precizie pregătire:
-- -24.9 min" din panoul partenerului. Semnul minus NU se ascunde; se repară
-- promisiunea față de care se măsoară, fiindcă în două cazuri ea nu exista.
--
-- (1) accept_order ștampila `estimated_ready_at = now() + prep` și pentru
--     comenzile PROGRAMATE, ignorând `requested_for`. Dovadă din DB-ul viu:
--     CHD-2026-000470, cerută pentru 12 aug 10:00, primise ținta 11 aug 20:23 —
--     cu 13,6 ore înaintea ferestrei. Consecințe pe trei suprafețe, nu doar în
--     KPI: partenerul vedea „🎯 Țintă: 20:23" și, 25 de minute mai târziu,
--     „⏱ Depășit — pregătește urgent" pentru o comandă de a doua zi dimineața;
--     clientul citea „Gata în ~29 min" exact sub propria lui etichetă
--     „🕒 Comandă programată pentru 12 aug., 13:00".
--
--     Ancora aleasă e `requested_for - 45 min`: exact pragul la care
--     20260811000000 deschide dispecerizarea, adică momentul în care platforma
--     însăși declară că începe partea de livrare — deci momentul în care
--     bucătăria trebuie să fie gata. Nu inventez o constantă nouă.
--     `greatest(...)` face ca o fereastră deja apropiată (sau trecută) să
--     degradeze onest la now()+prep, în loc să producă o țintă în trecut.
--
-- (2) restaurant_wait_kpis măsura precizia și pe comenzile cancelled/rejected,
--     deși CTE-ul `decisions` din ACELAȘI view le excludea deja — o
--     inconsecvență internă. O comandă întreruptă n-a dus la capăt niciun ciclu
--     de bucătărie, deci `min(ready_for_pickup)` de pe ea nu e semnal de
--     finalizare. În DB-ul viu, CHD-2026-000002 (cancelled pe 6 aug) avea un
--     eveniment de ready pe 13 aug și singură ducea Ciocana Grill House la
--     „+10017.6 min".
--
-- (3) Media n-avea prag de eșantion: Ciocana raporta o „statistică pe 30 de
--     zile" dintr-o singură comandă. Repo-ul are deja regula casei în
--     get_prep_estimates (orar≥5 → global≥5 → static): sub 5 observații nu se
--     pretinde o medie. Nimic nu se ascunde — `prep_accuracy_orders` expune
--     numărul de comenzi pe care se sprijină cifra (sau pe care nu se sprijină).

-- ===== 1. accept_order — recreat din corpul VIU, un singur delta =====
create or replace function public.accept_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status = 'accepted' then return; end if; -- idempotent no-op (WS1)
  if v_order.status <> 'pending_restaurant' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders
  set status = 'accepted',
      estimated_ready_at = case when v_order.order_type = 'standard'
        -- greatest() ignoră argumentele NULL în Postgres, deci comanda ASAP
        -- (requested_for is null) păstrează exact vechiul now()+prep.
        then greatest(
               now() + make_interval(mins => coalesce(
                 v_order.prep_time_override_minutes,
                 (select ge.prep_minutes from public.get_prep_estimates(array[v_order.restaurant_id]) ge)
               )),
               v_order.requested_for - interval '45 minutes'
             )
        else null end
  where id = p_order_id;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'accepted', (select role from public.profiles where id = auth.uid()), auth.uid());
end;
$function$;

-- ===== 2. restaurant_wait_kpis — recreat din viewdef-ul VIU =====
-- Coloană nouă APENDATĂ la final (Postgres acceptă doar adăugarea la coadă în
-- CREATE OR REPLACE VIEW); ordinea și tipurile celor 7 existente rămân intacte,
-- deci grant-urile din 20260727001100 se păstrează fără drop.
create or replace view public.restaurant_wait_kpis
with (security_invoker = on) as
with base as (
  select r.id as restaurant_id, r.name as restaurant_name
  from public.restaurants r
  where public.has_restaurant_access(r.id)
),
decisions as (
  select
    o.restaurant_id,
    count(*) filter (where o.status = 'rejected') as rejected_30d,
    count(*) as decided_30d
  from public.orders o
  where o.order_type = 'standard'
    and o.created_at >= now() - interval '30 days'
    and o.status not in ('pending_restaurant', 'cancelled')
  group by o.restaurant_id
),
prep as (
  -- Precizia se măsoară DOAR pe comenzi care au dus la capăt un ciclu normal
  -- de serviciu. Pozitiv = a întârziat față de estimare, negativ = a fost gata
  -- mai devreme. Filtrul cancelled/rejected aliniază CTE-ul ăsta cu `decisions`
  -- de mai sus, care excludea deja comenzile anulate.
  select
    o.restaurant_id,
    round(avg(extract(epoch from (rp.ready_at - o.estimated_ready_at)) / 60)::numeric, 1) as avg_minutes,
    count(*) as measured_orders
  from public.orders o
  cross join lateral (
    select min(e.created_at) as ready_at
    from public.delivery_status_events e
    where e.order_id = o.id and e.status = 'ready_for_pickup'
  ) rp
  where o.order_type = 'standard'
    and o.status not in ('cancelled', 'rejected')
    and o.estimated_ready_at is not null
    and rp.ready_at is not null
    and o.created_at >= now() - interval '30 days'
  group by o.restaurant_id
),
wait as (
  select
    o.restaurant_id,
    extract(epoch from (pu.picked_up_at - o.courier_arrived_restaurant_at)) / 60 as wait_minutes
  from public.orders o
  cross join lateral (
    select min(e.created_at) as picked_up_at
    from public.delivery_status_events e
    where e.order_id = o.id and e.status = 'picked_up'
  ) pu
  where o.courier_arrived_restaurant_at is not null
    and pu.picked_up_at is not null
    and o.created_at >= now() - interval '30 days'
),
wait_agg as (
  select
    restaurant_id,
    round(avg(wait_minutes)::numeric, 1) as avg_courier_wait_minutes,
    count(*) filter (where wait_minutes > public.current_avoidable_wait_grace_minutes()) as avoidable_wait_orders
  from wait
  group by restaurant_id
)
select
  b.restaurant_id,
  b.restaurant_name,
  case when coalesce(d.decided_30d, 0) = 0 then null
       else round(100.0 * coalesce(d.rejected_30d, 0) / d.decided_30d, 1) end as reject_rate_pct,
  -- pragul de 5 = aceeași regulă a casei ca get_prep_estimates (orar≥5 → global≥5)
  case when coalesce(p.measured_orders, 0) >= 5 then p.avg_minutes else null end as prep_accuracy_avg_minutes,
  wa.avg_courier_wait_minutes,
  coalesce(wa.avoidable_wait_orders, 0) as avoidable_wait_orders,
  public.current_avoidable_wait_grace_minutes() as avoidable_wait_grace_minutes,
  coalesce(p.measured_orders, 0) as prep_accuracy_orders
from base b
left join decisions d on d.restaurant_id = b.restaurant_id
left join prep p on p.restaurant_id = b.restaurant_id
left join wait_agg wa on wa.restaurant_id = b.restaurant_id;

revoke all on public.restaurant_wait_kpis from anon;
grant select on public.restaurant_wait_kpis to authenticated;
