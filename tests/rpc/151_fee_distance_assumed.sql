-- Courier pay on an assumed distance is flagged (migration 20261012000202_courier_fee_distance_assumed).
-- advance_delivery_status priced the final courier fee on a 6.0 km fallback when a pin was missing,
-- indistinguishable from a measured distance. Now orders.courier_fee_distance_assumed says which.
-- MONEY: the amount must NOT change (sim 23 pins "no address = base + per_km * 6.0"); this sim proves
-- the flag AND that the same fee is still paid.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_rlat numeric; v_rlng numeric; v_addr_pin uuid; v_addr_nopin uuid;
  v_c uuid; v_cu uuid;
  v_o_pin uuid; v_o_nopin uuid;
  v_t public.courier_tariff_config;
  v_fee numeric; v_flag boolean; v_expect numeric; v_dist numeric; n int;
begin
  select id, lat, lng into v_rest, v_rlat, v_rlng from public.restaurants where is_active and lat is not null order by name limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 151 pin', v_rlat + 0.0450, v_rlng) returning id into v_addr_pin;
  insert into public.addresses (customer_id, street_address) values (c_cust, 'Str. Sim 151 fara pin') returning id into v_addr_nopin;
  select id, user_id into v_c, v_cu from public.couriers where is_active order by id limit 1;
  select * into v_t from public.current_courier_tariff();

  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr_pin, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230) returning id into v_o_pin;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr_nopin, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230) returning id into v_o_nopin;
  update public.dispatch_offers set status = 'declined' where status = 'offered';
  update public.orders set courier_id = v_c, status = 'courier_assigned', courier_fee_quoted_mdl = null where id in (v_o_pin, v_o_nopin);

  perform set_config('request.jwt.claims', json_build_object('sub', v_cu, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ===== F1: before delivery the flag is false for both (it only describes a DELIVERED fee) =====
  perform public.advance_delivery_status(v_o_pin, 'picked_up');
  perform public.advance_delivery_status(v_o_nopin, 'picked_up');
  perform public.advance_delivery_status(v_o_nopin, 'en_route');
  reset role;
  select count(*) into n from public.orders where id in (v_o_pin, v_o_nopin) and courier_fee_distance_assumed;
  if n <> 0 then raise exception 'FAIL 151.F1: % order(s) flagged before delivery', n; end if;
  raise notice 'PASS 151.F1: nothing flagged before delivery';

  set local role authenticated;
  perform public.advance_delivery_status(v_o_nopin, 'delivered', true);
  perform public.advance_delivery_status(v_o_pin, 'en_route');
  perform public.advance_delivery_status(v_o_pin, 'delivered', true);
  reset role;

  -- ===== F2: pinless drop-off -> flagged AND paid exactly as before (base + per_km * 6.0) =====
  select courier_fee_mdl, courier_fee_distance_assumed into v_fee, v_flag from public.orders where id = v_o_nopin;
  v_expect := round(v_t.base_mdl + v_t.per_km_mdl * 6.0, 2);
  if v_flag is distinct from true then raise exception 'FAIL 151.F2: pinless delivery not flagged (flag=%)', v_flag; end if;
  if v_fee is distinct from v_expect then raise exception 'FAIL 151.F2: amount changed: paid % expected % (base+per_km*6.0)', v_fee, v_expect; end if;
  raise notice 'PASS 151.F2: pinless delivery flagged, fee unchanged at % MDL', v_fee;

  -- ===== F3: pinned drop-off -> NOT flagged, paid on the measured distance =====
  select courier_fee_mdl, courier_fee_distance_assumed into v_fee, v_flag from public.orders where id = v_o_pin;
  v_dist := public.haversine_km(v_rlat, v_rlng, v_rlat + 0.0450, v_rlng);
  v_expect := round(v_t.base_mdl + v_t.per_km_mdl * v_dist, 2);
  if v_flag is distinct from false then raise exception 'FAIL 151.F3: pinned delivery wrongly flagged (flag=%)', v_flag; end if;
  if v_fee is distinct from v_expect then raise exception 'FAIL 151.F3: pinned fee % expected % on %.2f km', v_fee, v_expect, v_dist; end if;
  raise notice 'PASS 151.F3: pinned delivery not flagged, fee % MDL on % km', v_fee, round(v_dist, 2);

  -- ===== F4: the courier cannot clear the flag by writing to orders directly =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_cu, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.orders set courier_fee_distance_assumed = false where id = v_o_nopin;
  exception when insufficient_privilege then null;
  end;
  reset role;
  select courier_fee_distance_assumed into v_flag from public.orders where id = v_o_nopin;
  if v_flag is distinct from true then raise exception 'FAIL 151.F4: courier cleared the flag'; end if;
  raise notice 'PASS 151.F4: the courier cannot clear the flag';
end $$;
