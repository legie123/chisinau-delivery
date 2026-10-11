-- Dispatch ranks real, fresh positions first (migration 20261011000300_dispatch_fresh_rank).
-- dispatch_order trusted a courier position for 10 minutes and gave a courier with no position an
-- assumed 6.0 km, then wrote that 6.0 into dispatch_offers.distance_km, which both courier apps
-- show as "~6.0 km până la restaurant". So a courier with no GPS beat one really 8 km away, and a
-- 5-minute-old position beat a live one. After: positions count only for 2 minutes (as in
-- nearby_available_couriers), couriers with a fresh position rank before those without, ties break
-- on courier id, and an unknown distance is stored as null ("Distanță estimată" in both apps).
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_rlat numeric; v_rlng numeric; v_addr uuid;
  v_a uuid; v_b uuid; v_o1 uuid; v_o2 uuid; v_o3 uuid; v_offer uuid; v_to uuid; v_dist numeric;
begin
  select id, lat, lng into v_rest, v_rlat, v_rlng from public.restaurants
  where is_active and lat is not null order by name limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 90', 47.02, 28.83)
  returning id into v_addr;

  update public.couriers set status = 'offline' where status = 'online';
  select id into v_a from public.couriers where is_active and public.courier_has_capacity(id) order by id limit 1;
  select id into v_b from public.couriers where is_active and public.courier_has_capacity(id) and id <> v_a order by id limit 1;
  if v_b is null then raise exception 'FAIL 90.setup: need two couriers with capacity'; end if;
  update public.couriers set status = 'online', vehicle_type = 'bike' where id in (v_a, v_b);
  update public.dispatch_offers set status = 'declined' where courier_id in (v_a, v_b) and status = 'offered';
  delete from public.courier_locations where courier_id in (v_a, v_b);

  -- A fresh at ~4 km, B at ~0.5 km but last seen 5 minutes ago (fresh for the old 10-min window).
  set local session_replication_role = replica;  -- keep the chosen updated_at values
  insert into public.courier_locations (courier_id, lat, lng, is_plausible, updated_at)
  values (v_a, v_rlat + 0.036, v_rlng, true, now() - interval '30 seconds'),
         (v_b, v_rlat + 0.0045, v_rlng, true, now() - interval '5 minutes');
  set local session_replication_role = origin;

  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230)
  returning id into v_o1;

  -- ===== D1: a live position beats a 5-minute-old one =====
  v_offer := public.dispatch_order(v_o1);
  select courier_id into v_to from public.dispatch_offers where id = v_offer;
  if v_to is distinct from v_a then raise exception 'FAIL 90.D1: offer went to the stale courier (% instead of %)', v_to, v_a; end if;
  raise notice 'PASS 90.D1: fresh 4 km courier chosen over a 5-min-old 0.5 km position';
  update public.dispatch_offers set status = 'declined' where id = v_offer;

  -- ===== D2: no position at all no longer counts as 6 km =====
  delete from public.courier_locations where courier_id = v_b;
  set local session_replication_role = replica;
  update public.courier_locations set lat = v_rlat + 0.072, updated_at = now() - interval '20 seconds' where courier_id = v_a;
  set local session_replication_role = origin;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230)
  returning id into v_o2;
  v_offer := public.dispatch_order(v_o2);
  select courier_id, distance_km into v_to, v_dist from public.dispatch_offers where id = v_offer;
  if v_to is distinct from v_a then raise exception 'FAIL 90.D2: courier with no GPS beat a real 8 km one (% got it)', v_to; end if;
  if v_dist is null or v_dist < 7 then raise exception 'FAIL 90.D2: real distance not stored (%)', v_dist; end if;
  raise notice 'PASS 90.D2: real 8 km courier chosen over one with no position (stored % km)', round(v_dist, 1);
  update public.dispatch_offers set status = 'declined' where id = v_offer;

  -- ===== D3: offered to a courier with no position -> distance stored as null, not 6.0 =====
  update public.couriers set status = 'offline' where id = v_a;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230)
  returning id into v_o3;
  v_offer := public.dispatch_order(v_o3);
  select courier_id, distance_km into v_to, v_dist from public.dispatch_offers where id = v_offer;
  if v_to is distinct from v_b then raise exception 'FAIL 90.D3: the only eligible courier was not offered (%)', v_to; end if;
  if v_dist is not null then raise exception 'FAIL 90.D3: unknown distance stored as % km', v_dist; end if;
  raise notice 'PASS 90.D3: courier without position still offered, distance stored as null';
end $$;
