-- Faza 5 #3 — suprataxa de vreme/vârf din tabelul de tarife publicat (audit §8:
-- "bază fixă + per-km + așteptare după 3 min + suprataxă de vreme"). Versionată
-- prin courier_tariff_config (o versiune nouă cu suprataxă >0 = pornit; alta cu
-- 0 = oprit; anunțată curierilor prin outbox ca orice schimbare de tarif).
-- Suprataxa se STAMPEAZĂ pe comandă la cotare (mark_ready) — podeaua rămâne
-- podea, niciodată surge retroactiv. Bugetul ≤10% din brut devine măsurabil
-- (KPI #6 în admin_pilot_go_no_go).

alter table public.courier_tariff_config
  add column if not exists weather_surcharge_mdl numeric not null default 0
  check (weather_surcharge_mdl >= 0);

alter table public.orders
  add column if not exists courier_fee_surcharge_mdl numeric;

-- Setter: semnătură nouă (param în plus, cu default — apelurile vechi merg).
drop function if exists public.set_courier_tariff(numeric, numeric, numeric, integer, timestamptz, text);
create or replace function public.set_courier_tariff(
  p_base_mdl numeric, p_per_km_mdl numeric, p_wait_per_min_mdl numeric,
  p_wait_grace_minutes integer default 3, p_effective_from timestamptz default now(),
  p_note text default null, p_weather_surcharge_mdl numeric default 0
)
returns uuid
language plpgsql security definer
set search_path to 'public', 'auth'
as $$
declare v_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  if p_weather_surcharge_mdl < 0 then raise exception 'suprataxa trebuie sa fie >= 0'; end if;

  insert into public.courier_tariff_config
    (effective_from, base_mdl, per_km_mdl, wait_per_min_mdl, wait_grace_minutes, weather_surcharge_mdl, note, created_by)
  values (p_effective_from, p_base_mdl, p_per_km_mdl, p_wait_per_min_mdl, p_wait_grace_minutes, p_weather_surcharge_mdl, p_note, auth.uid())
  returning id into v_id;

  -- to_char(7,'FM990.99') dă "7." — rtrim pe punct pentru numere curate în anunț
  insert into public.notification_outbox (user_id, title, body, url, tag)
  select c.user_id, 'Actualizare tarif curier',
         format('Tarif nou de la %s: bază %s MDL + %s MDL/km + %s MDL/min așteptare (după %s min)%s. Tariful e mereu un minim — poate crește.',
                p_effective_from::date,
                rtrim(trim(to_char(p_base_mdl, 'FM990.99')), '.'), rtrim(trim(to_char(p_per_km_mdl, 'FM990.99')), '.'),
                rtrim(trim(to_char(p_wait_per_min_mdl, 'FM990.99')), '.'), p_wait_grace_minutes,
                case when p_weather_surcharge_mdl > 0
                     then format(' + suprataxă vreme %s MDL/livrare', rtrim(trim(to_char(p_weather_surcharge_mdl, 'FM990.99')), '.'))
                     else '' end),
         '/earnings', 'pricing'
  from public.couriers c where c.is_active;

  return v_id;
end;
$$;
revoke execute on function public.set_courier_tariff(numeric, numeric, numeric, integer, timestamptz, text, numeric) from public, anon;
grant execute on function public.set_courier_tariff(numeric, numeric, numeric, integer, timestamptz, text, numeric) to authenticated;

-- mark_ready_for_pickup: corp LIVE + (1) cota include suprataxa activă,
-- (2) componenta se stampează separat pe comandă (bugetul ≤10% devine măsurabil).
create or replace function public.mark_ready_for_pickup(p_order_id uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'auth'
as $$
declare
  v_order public.orders%rowtype;
  v_tariff public.courier_tariff_config;
  v_r_lat numeric; v_r_lng numeric; v_a_lat numeric; v_a_lng numeric;
  v_dist_km numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status = 'ready_for_pickup' then return; end if; -- idempotent
  if v_order.status <> 'accepted' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders set status = 'ready_for_pickup' where id = p_order_id;

  -- Order 2 — quote the courier fee floor now, before dispatch offers it out.
  select lat, lng into v_r_lat, v_r_lng from public.restaurants where id = v_order.restaurant_id;
  select lat, lng into v_a_lat, v_a_lng from public.addresses where id = v_order.delivery_address_id;
  select * into v_tariff from public.current_courier_tariff();
  v_dist_km := coalesce(public.haversine_km(v_r_lat, v_r_lng, v_a_lat, v_a_lng), 6.0);
  update public.orders
    set courier_fee_quoted_mdl = round(v_tariff.base_mdl + v_tariff.per_km_mdl * v_dist_km + v_tariff.weather_surcharge_mdl, 2),
        courier_fee_surcharge_mdl = nullif(v_tariff.weather_surcharge_mdl, 0)
    where id = p_order_id;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'ready_for_pickup', (select role from public.profiles where id = auth.uid()), auth.uid());

  begin
    perform public.dispatch_order(p_order_id); -- WS2: push dispatch
  exception when others then
    raise warning 'dispatch_order(%) failed: %', p_order_id, sqlerrm; -- never block the restaurant
  end;
end;
$$;

-- advance_delivery_status: corp LIVE + suprataxa STAMPATĂ intră în recompunerea
-- finală (nu cea curentă — fără surge retroactiv; podeaua oricum protejează).
create or replace function public.advance_delivery_status(p_order_id uuid, p_new_status text, p_payment_confirmed boolean default null)
returns void
language plpgsql security definer
set search_path to 'public', 'auth'
as $$
declare
  v_order public.orders%rowtype;
  v_allowed text[];
  v_tariff public.courier_tariff_config;
  v_r_lat numeric; v_r_lng numeric; v_a_lat numeric; v_a_lng numeric;
  v_dist_km numeric;
  v_wait_minutes numeric;
  v_final_fee numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if v_order.courier_id not in (select id from public.couriers where user_id = auth.uid()) and not has_role('platform_admin') then
    raise exception 'not authorized';
  end if;

  if v_order.status = p_new_status then return; end if; -- idempotent retry

  v_allowed := case v_order.status
    when 'courier_assigned' then array['picked_up']
    when 'picked_up' then array['en_route']
    when 'en_route' then array['delivered']
    else array[]::text[]
  end;
  if not (p_new_status = any(v_allowed)) then
    raise exception 'invalid transition % -> %', v_order.status, p_new_status;
  end if;

  -- MONEY GATE: a prepaid (online) order must be paid before it is handed over.
  if p_new_status = 'delivered'
     and v_order.payment_method = 'online_gateway'
     and v_order.payment_status <> 'paid' then
    raise exception 'online order % cannot be delivered before payment is confirmed (payment_status=%)',
      v_order.order_number, v_order.payment_status;
  end if;

  -- Order 2 — final courier fee, floored at the quote stamped by
  -- mark_ready_for_pickup. Distance recomputed the same way (restaurant ->
  -- delivery address, 6km fallback) in case either location changed.
  if p_new_status = 'delivered' then
    select * into v_tariff from public.current_courier_tariff();
    select lat, lng into v_r_lat, v_r_lng from public.restaurants where id = v_order.restaurant_id;
    select lat, lng into v_a_lat, v_a_lng from public.addresses where id = v_order.delivery_address_id;
    v_dist_km := coalesce(public.haversine_km(v_r_lat, v_r_lng, v_a_lat, v_a_lng), 6.0);
    v_wait_minutes := 0; -- observe-only ruling: fără compensare automată în pilot
    v_final_fee := round(v_tariff.base_mdl + v_tariff.per_km_mdl * v_dist_km + v_tariff.wait_per_min_mdl * v_wait_minutes
                         + coalesce(v_order.courier_fee_surcharge_mdl, 0), 2);
    v_final_fee := greatest(coalesce(v_order.courier_fee_quoted_mdl, 0), v_final_fee);
  end if;

  update public.orders
  set status = p_new_status,
      delivered_at = case when p_new_status = 'delivered' then now() else delivered_at end,
      courier_fee_mdl = case when p_new_status = 'delivered' then v_final_fee else courier_fee_mdl end,
      payment_status = case
        when p_new_status = 'delivered' and p_payment_confirmed and payment_method <> 'online_gateway' then 'paid'
        else payment_status
      end
  where id = p_order_id;

  if p_new_status = 'delivered' then
    update public.couriers set status = 'online' where id = v_order.courier_id;
  end if;

  -- CASH FLOAT accrual (order 1 — COD-only pilot). ONLY payment_method='cash'
  -- accrues a liability: card_on_delivery settles electronically on a POS
  -- terminal and never sits in the courier's pocket. If this pushes the
  -- courier's float to/past the cap, enforce_cash_cap_offline (trigger on
  -- courier_cash_movements) forces them back offline right here.
  if p_new_status = 'delivered' and p_payment_confirmed and v_order.payment_method = 'cash' and v_order.total_mdl > 0 then
    insert into public.courier_cash_movements (courier_id, order_id, kind, amount_mdl)
    values (v_order.courier_id, v_order.id, 'collected', v_order.total_mdl);
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, p_new_status, case when has_role('courier') then 'courier' else 'platform_admin' end, auth.uid());
end;
$$;

-- Transparența publică: istoricul include acum și suprataxa (return type nou → drop).
drop function if exists public.public_courier_tariff_history();
create or replace function public.public_courier_tariff_history()
returns table(id uuid, effective_from timestamptz, base_mdl numeric, per_km_mdl numeric,
              wait_per_min_mdl numeric, wait_grace_minutes integer, weather_surcharge_mdl numeric, note text)
language sql stable security definer
set search_path to 'public'
as $$
  select ctc.id, ctc.effective_from, ctc.base_mdl, ctc.per_km_mdl, ctc.wait_per_min_mdl,
         ctc.wait_grace_minutes, ctc.weather_surcharge_mdl, ctc.note
  from public.courier_tariff_config ctc
  order by ctc.effective_from asc;
$$;
grant execute on function public.public_courier_tariff_history() to anon, authenticated;

-- KPI #6 din go/no-go devine măsurabil: buget suprataxă = componenta stampată /
-- brutul curierului, 14d, ținta ≤10%. Recreăm doar acest item — restul identic.
create or replace function public.admin_pilot_go_no_go_surge_pct()
returns numeric
language sql stable security definer
set search_path to 'public'
as $$
  select round(100.0 * sum(coalesce(o.courier_fee_surcharge_mdl, 0))
               / nullif(sum(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl)), 0), 1)
  from public.orders o
  where o.status = 'delivered' and o.delivered_at >= now() - interval '14 days';
$$;
revoke execute on function public.admin_pilot_go_no_go_surge_pct() from public, anon, authenticated;

-- Recreăm admin_pilot_go_no_go DOAR cu itemul 6 schimbat (restul identic cu
-- 20260731000000): bugetul de suprataxă se măsoară acum din componenta stampată.
create or replace function public.admin_pilot_go_no_go()
returns table (kpi text, value_text text, target_text text, status text)
language plpgsql stable security definer
set search_path = public, auth
as $$
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

  select round(avg(o.courier_fee_mdl / nullif(o.delivery_fee_mdl, 0)) * 100, 1) into v
  from public.orders o
  where o.status = 'delivered' and o.delivered_at >= now() - interval '14 days'
    and o.courier_fee_mdl is not null and o.delivery_fee_mdl > 0;
  return query select 'Cota curierului din tarif', coalesce(v::text || '%', '—'), '70–75%',
    case when v is null then 'no_data' when v between 70 and 75 then 'pass' else 'fail' end;

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
$$;
