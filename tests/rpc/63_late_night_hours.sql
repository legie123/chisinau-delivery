-- Program de noapte până la 03:00 (2026-08-15). Cererea proprietarului: comenzi
-- acceptate până la 3 dimineața. Ambele straturi știau deja să citească un
-- interval care sare peste miezul nopții; sim-ul dovedește că lanțul întreg —
-- `restaurant_open_at` + gardul din `place_order` — chiar acceptă comanda la 2
-- noaptea și o respinge la 4, când localul e închis.
-- S1: 02:00 (după miezul nopții, în fereastra de ieri) → deschis.
-- S2: 23:30 (aceeași zi, după 22:00 vechi) → deschis.
-- S3: 04:00 (în afara ferestrei) → închis.
-- S4: `place_order` chiar plasează comanda programată la 02:00.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';   -- Sakura
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_qty int; v_addr uuid; v_oid uuid;
  v_at timestamptz;
  v_open boolean;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '11:00'::time, '03:00'::time, false from generate_series(0, 6) d;

  -- ===== S1: 02:00, noaptea — fereastra deschisă ieri seară =====
  v_at := (date_trunc('day', now() at time zone 'Europe/Chisinau') + interval '2 hours')
          at time zone 'Europe/Chisinau';
  v_open := public.restaurant_open_at(v_rest, v_at);
  if not v_open then
    raise exception 'FAIL S1: la 02:00 localul e raportat închis, deși programul ține până la 03:00';
  end if;
  raise notice 'PASS S1: la 02:00 localul e deschis (fereastra de peste noapte)';

  -- ===== S2: 23:30, aceeași zi =====
  v_at := (date_trunc('day', now() at time zone 'Europe/Chisinau') + interval '23 hours 30 minutes')
          at time zone 'Europe/Chisinau';
  if not public.restaurant_open_at(v_rest, v_at) then
    raise exception 'FAIL S2: la 23:30 localul e raportat închis';
  end if;
  raise notice 'PASS S2: la 23:30 localul e deschis';

  -- ===== S3: 04:00 — în afara programului =====
  v_at := (date_trunc('day', now() at time zone 'Europe/Chisinau') + interval '4 hours')
          at time zone 'Europe/Chisinau';
  if public.restaurant_open_at(v_rest, v_at) then
    raise exception 'FAIL S3: la 04:00 localul apare deschis, deși se închide la 03:00';
  end if;
  raise notice 'PASS S3: la 04:00 localul e închis — fereastra nu se scurge la nesfârșit';

  -- ===== S4: comandă programată la 02:00, prin RPC =====
  select mi.id, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int
    into v_item, v_qty
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- mâine la 02:00, ca să fie mereu în viitor indiferent de ora rulării
  v_at := ((date_trunc('day', now() at time zone 'Europe/Chisinau') + interval '1 day 2 hours')
           at time zone 'Europe/Chisinau');

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'card_on_delivery',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)),
    v_addr, v_at, null, null);
  perform set_config('request.jwt.claims', null, true);

  if v_oid is null then
    raise exception 'FAIL S4: comanda programată la 02:00 nu a fost plasată';
  end if;
  raise notice 'PASS S4: comanda programată la 02:00 trece de gardul de program';
end $$;
