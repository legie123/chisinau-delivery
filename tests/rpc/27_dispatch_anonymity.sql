-- Order 6 — dispatch anonymity (20260727001300). Proves the (1-acceptance_rate)*alpha1
-- reject-penalty term is STRUCTURALLY gone from dispatch_order(), not just
-- zero-weighted: a candidate with a genuinely bad 14d acceptance history (two
-- real 'expired' offers in the seed data, 0% rate) scores IDENTICALLY whether
-- dispatch_scoring_config.alpha1 is 0 or a huge nonzero value. Also proves the
-- decline cascade (unrelated to alpha1) still works. Rolled back by the runner.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  -- courier 003 already carries 2 REAL 'expired' offers in the seed data
  -- (order e...003, e...022, both < 14d old) => 0% acceptance rate. If the
  -- reject-penalty term still existed anywhere in dispatch_order, this
  -- courier's score would swing hard between alpha1=0 and alpha1=500.
  v_courier_user uuid := 'c0000000-0000-0000-0000-000000000003';
  v_courier2_user uuid := 'c0000000-0000-0000-0000-000000000006';
  v_courier uuid; v_courier2 uuid;
  v_item uuid; v_addr uuid;
  v_oid_a uuid; v_oid_b uuid; v_oid_c uuid;
  v_offer_a uuid; v_offer_b uuid; v_offer_c1 uuid; v_offer_c2 uuid;
  v_score_a numeric; v_score_b numeric;
  v_won_courier uuid; v_won_user uuid; v_other_courier uuid; v_other_user uuid;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;
  select id into v_courier2 from public.couriers where user_id = v_courier2_user;

  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- isolate: everyone else offline, only v_courier online/capable for part 1
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id in (v_courier, v_courier2) and status in ('courier_assigned','picked_up','en_route');
  update public.couriers set status = 'offline' where id <> v_courier;
  update public.couriers set status = 'online', is_active = true where id = v_courier;
  -- seed data ships a LIVE 'offered' row for this courier; on a fresh db reset the
  -- 15s sweeper hasn't expired it yet and it blocks candidacy (one live offer per
  -- courier) — cancel it here so the sim is self-contained, not sweeper-dependent
  update public.dispatch_offers set status = 'cancelled'
  where courier_id in (v_courier, v_courier2) and status = 'offered';

  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier, 47.05, 28.85, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now(), is_plausible = true;

  -- ===== part 1: score IDENTICAL across alpha1=0 vs alpha1=500 =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.set_dispatch_scoring_config(1, 0, 0, now(), 'test: anonymity baseline alpha1=0');

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid_a := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid_a);
  perform public.mark_ready_for_pickup(v_oid_a);

  select id, score into v_offer_a, v_score_a from public.dispatch_offers
  where order_id = v_oid_a and status = 'offered';
  if v_offer_a is null then raise exception 'FAIL: part1 (alpha1=0) — dispatch fired no offer'; end if;
  -- free the courier for round 2 without touching capacity/status
  update public.dispatch_offers set status = 'cancelled' where id = v_offer_a;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.set_dispatch_scoring_config(1, 500, 0, now(), 'test: anonymity alpha1=500 (would dominate under the old formula)');

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid_b := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid_b);
  perform public.mark_ready_for_pickup(v_oid_b);

  select id, score into v_offer_b, v_score_b from public.dispatch_offers
  where order_id = v_oid_b and status = 'offered';
  if v_offer_b is null then raise exception 'FAIL: part1 (alpha1=500) — dispatch fired no offer'; end if;

  if v_score_a is distinct from v_score_b then
    raise exception 'FAIL: score changed with alpha1 (a=%, b=%) — reject-penalty term still present', v_score_a, v_score_b;
  end if;

  raise notice 'PASS dispatch-anonymity part1: score IDENTICAL (%) across alpha1=0 and alpha1=500 — reject-penalty term structurally gone', v_score_a;

  -- ===== part 2: decline cascade still works (unrelated to alpha1) =====
  update public.dispatch_offers set status = 'cancelled' where id = v_offer_b;
  update public.couriers set status = 'online', is_active = true where id = v_courier2;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier2, 47.10, 28.95, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now(), is_plausible = true;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid_c := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid_c);
  perform public.mark_ready_for_pickup(v_oid_c);

  select id, courier_id into v_offer_c1, v_won_courier from public.dispatch_offers
  where order_id = v_oid_c and status = 'offered';
  if v_offer_c1 is null then raise exception 'FAIL: part2 — no initial offer fired'; end if;

  if v_won_courier = v_courier then v_won_user := v_courier_user; v_other_courier := v_courier2; v_other_user := v_courier2_user;
  else v_won_user := v_courier2_user; v_other_courier := v_courier; v_other_user := v_courier_user;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_won_user,'role','authenticated')::text, true);
  perform public.decline_dispatch_offer(v_offer_c1);

  select id, courier_id into v_offer_c2 from public.dispatch_offers
  where order_id = v_oid_c and status = 'offered';
  if v_offer_c2 is null then raise exception 'FAIL: part2 — decline did not cascade to a new offer'; end if;
  if v_offer_c2 = v_offer_c1 then raise exception 'FAIL: cascade returned the same offer'; end if;
  perform 1 from public.dispatch_offers where id = v_offer_c2 and courier_id = v_other_courier;
  if not found then raise exception 'FAIL: cascade did not offer the other candidate'; end if;

  raise notice 'PASS dispatch-anonymity part2: decline cascaded to the other courier (wave up)';
end $$;
