-- offer_preview (migration 20261012000201): sector + distances for a LIVE offer, to its holder only.
-- Before: the courier saw restaurant, earnings and pickup km, but not where the order goes or how long
-- the whole trip is (the address is unreadable until assignment). The function must tell the holder
-- that, and tell NOBODY else anything — a wrong caller gets zero rows, the same as for a missing id.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_rlat numeric; v_rlng numeric; v_addr uuid; v_addr_nopin uuid;
  v_a uuid; v_b uuid; v_ua uuid; v_ub uuid;
  v_o1 uuid; v_o2 uuid; v_offer uuid; v_offer2 uuid;
  n int; r record; v_expect_trip numeric;
begin
  select id, lat, lng into v_rest, v_rlat, v_rlng from public.restaurants
  where is_active and lat is not null order by name limit 1;
  insert into public.addresses (customer_id, street_address, sector, lat, lng)
  values (c_cust, 'Str. Sim 150 nr. 7', 'Botanica', v_rlat + 0.0450, v_rlng) returning id into v_addr;
  insert into public.addresses (customer_id, street_address, sector)
  values (c_cust, 'Str. Fara Pin 150', 'Ciocana') returning id into v_addr_nopin;
  v_expect_trip := round(public.haversine_km(v_rlat, v_rlng, v_rlat + 0.0450, v_rlng), 2);

  update public.couriers set status = 'offline' where status = 'online';
  select id, user_id into v_a, v_ua from public.couriers where is_active order by id limit 1;
  select id, user_id into v_b, v_ub from public.couriers where is_active and id <> v_a order by id limit 1;
  if v_b is null then raise exception 'FAIL 150.setup: need two active couriers'; end if;
  update public.dispatch_offers set status = 'declined' where courier_id in (v_a, v_b) and status = 'offered';

  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230)
  returning id into v_o1;
  insert into public.dispatch_offers (order_id, courier_id, score, distance_km, expires_at)
  values (v_o1, v_a, 1, 2.40, now() + interval '30 seconds') returning id into v_offer;

  -- ===== P1: the holder gets exactly one row with sector and the three distances =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.offer_preview(v_offer);
  select * into r from public.offer_preview(v_offer);
  reset role;
  if n <> 1 then raise exception 'FAIL 150.P1: holder got % rows', n; end if;
  if r.dropoff_sector is distinct from 'Botanica' then raise exception 'FAIL 150.P1: sector %', r.dropoff_sector; end if;
  if r.pickup_km is distinct from 2.40 then raise exception 'FAIL 150.P1: pickup_km %', r.pickup_km; end if;
  if r.trip_km is distinct from v_expect_trip then raise exception 'FAIL 150.P1: trip_km % expected %', r.trip_km, v_expect_trip; end if;
  if r.total_km is distinct from round(2.40 + v_expect_trip, 2) then raise exception 'FAIL 150.P1: total_km %', r.total_km; end if;
  raise notice 'PASS 150.P1: holder sees sector %, pickup % km, trip % km, total % km', r.dropoff_sector, r.pickup_km, r.trip_km, r.total_km;

  -- ===== P2: another courier gets zero rows for the same offer id =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.offer_preview(v_offer);
  reset role;
  if n <> 0 then raise exception 'FAIL 150.P2: another courier got % rows', n; end if;
  raise notice 'PASS 150.P2: another courier gets 0 rows';

  -- ===== P3: the customer who placed the order gets zero rows =====
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.offer_preview(v_offer);
  reset role;
  if n <> 0 then raise exception 'FAIL 150.P3: customer got % rows', n; end if;
  raise notice 'PASS 150.P3: the customer gets 0 rows';

  -- ===== P4: anon cannot even call it (EXECUTE revoked, not just filtered) =====
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform * from public.offer_preview(v_offer);
    reset role;
    raise exception 'FAIL 150.P4: anon could execute offer_preview';
  exception when insufficient_privilege then
    reset role;
    raise notice 'PASS 150.P4: anon is denied EXECUTE';
  end;

  -- ===== P5: expired, declined and accepted offers give the holder nothing =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  update public.dispatch_offers set expires_at = now() - interval '1 second' where id = v_offer;
  set local role authenticated;
  select count(*) into n from public.offer_preview(v_offer);
  reset role;
  if n <> 0 then raise exception 'FAIL 150.P5: past-expiry offer still previewed (% rows)', n; end if;
  update public.dispatch_offers set expires_at = now() + interval '30 seconds', status = 'declined' where id = v_offer;
  set local role authenticated;
  select count(*) into n from public.offer_preview(v_offer);
  reset role;
  if n <> 0 then raise exception 'FAIL 150.P5: declined offer still previewed (% rows)', n; end if;
  raise notice 'PASS 150.P5: expired and declined offers give 0 rows';

  -- ===== P6: no drop-off pin / no courier fix -> nulls, never invented numbers; sector still shown =====
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr_nopin, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230)
  returning id into v_o2;
  insert into public.dispatch_offers (order_id, courier_id, score, distance_km, expires_at)
  values (v_o2, v_a, 1, null, now() + interval '30 seconds') returning id into v_offer2;
  set local role authenticated;
  select * into r from public.offer_preview(v_offer2);
  reset role;
  if r.dropoff_sector is distinct from 'Ciocana' then raise exception 'FAIL 150.P6: sector %', r.dropoff_sector; end if;
  if r.pickup_km is not null or r.trip_km is not null or r.total_km is not null then
    raise exception 'FAIL 150.P6: invented numbers pickup=% trip=% total=%', r.pickup_km, r.trip_km, r.total_km;
  end if;
  raise notice 'PASS 150.P6: no pin and no fix -> sector shown, distances null';

  -- ===== P8: an ACCEPTED offer gives the holder nothing (the address is theirs by then, not a preview) =====
  update public.dispatch_offers set status = 'accepted' where id = v_offer2;
  set local role authenticated;
  select count(*) into n from public.offer_preview(v_offer2);
  reset role;
  if n <> 0 then raise exception 'FAIL 150.P8: accepted offer still previewed (% rows)', n; end if;
  raise notice 'PASS 150.P8: accepted offer gives 0 rows';

  -- ===== P9: a live ('offered') offer on a CANCELLED order gives nothing (expire_stale_orders cancels the
  --       order but leaves its offer 'offered') =====
  update public.dispatch_offers set status = 'offered', expires_at = now() + interval '30 seconds' where id = v_offer2;
  update public.orders set status = 'cancelled' where id = v_o2;
  set local role authenticated;
  select count(*) into n from public.offer_preview(v_offer2);
  reset role;
  if n <> 0 then raise exception 'FAIL 150.P9: cancelled order still previewed (% rows)', n; end if;
  raise notice 'PASS 150.P9: live offer on a cancelled order gives 0 rows';

  -- ===== P7: a deactivated courier holding a live offer gets nothing =====
  update public.dispatch_offers set status = 'declined' where id = v_offer2;  -- one live offer per courier
  update public.dispatch_offers set status = 'offered', expires_at = now() + interval '30 seconds' where id = v_offer;
  update public.couriers set is_active = false where id = v_a;
  set local role authenticated;
  select count(*) into n from public.offer_preview(v_offer);
  reset role;
  if n <> 0 then raise exception 'FAIL 150.P7: inactive courier got % rows', n; end if;
  raise notice 'PASS 150.P7: inactive courier gets 0 rows';
end $$;
