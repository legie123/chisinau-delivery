-- System scenario 9 (gate I3): the network drops and the app sends the same action twice (the driver's offline
-- queue replays, a double tap). Every courier-side step must be idempotent: one assignment, one event per
-- transition, ONE cash movement and the same fee for a delivery confirmed twice, and a late replay of an older
-- step never moves the order backwards.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_rlat numeric; v_rlng numeric; v_addr uuid; v_a uuid; v_ua uuid; v_o uuid; v_off uuid;
  n int; v_fee numeric; v_fee2 numeric; v_st text; v_msg text;
begin
  select id, lat, lng into v_rest, v_rlat, v_rlng from public.restaurants where is_active and lat is not null order by name limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 156', v_rlat + 0.01, v_rlng) returning id into v_addr;
  update public.couriers set status = 'offline' where status = 'online';
  select id, user_id into v_a, v_ua from public.couriers where is_active and public.courier_has_capacity(id) order by id limit 1;
  update public.couriers set status = 'online', vehicle_type = 'bike' where id = v_a;
  update public.dispatch_offers set status = 'declined' where courier_id = v_a and status = 'offered';
  delete from public.courier_locations where courier_id = v_a;
  insert into public.courier_locations (courier_id, lat, lng, is_plausible) values (v_a, v_rlat + 0.003, v_rlng, true);
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230) returning id into v_o;
  v_off := public.dispatch_order(v_o);

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ===== D1: accept twice -> one assignment, one courier_assigned event =====
  perform public.accept_dispatch_offer(v_off);
  perform public.accept_dispatch_offer(v_off);
  reset role;
  select count(*) into n from public.delivery_status_events where order_id = v_o and status = 'courier_assigned';
  if n <> 1 or (select courier_id from public.orders where id = v_o) is distinct from v_a then
    raise exception 'FAIL 156.D1: double accept -> % assigned events', n;
  end if;
  raise notice 'PASS 156.D1: double accept = one assignment, one event';

  -- ===== D2: every transition sent twice -> one event each =====
  set local role authenticated;
  perform public.advance_delivery_status(v_o, 'picked_up');
  perform public.advance_delivery_status(v_o, 'picked_up');
  perform public.advance_delivery_status(v_o, 'en_route');
  perform public.advance_delivery_status(v_o, 'en_route');
  reset role;
  select count(*) into n from public.delivery_status_events where order_id = v_o and status in ('picked_up', 'en_route');
  if n <> 2 then raise exception 'FAIL 156.D2: % picked_up/en_route events for 4 calls (expected 2)', n; end if;
  raise notice 'PASS 156.D2: repeated transitions write one event each';

  -- ===== D3: cash delivery confirmed twice -> ONE cash movement, same fee, one delivered event =====
  set local role authenticated;
  perform public.advance_delivery_status(v_o, 'delivered', true);
  reset role;
  select courier_fee_mdl into v_fee from public.orders where id = v_o;
  set local role authenticated;
  perform public.advance_delivery_status(v_o, 'delivered', true);
  reset role;
  select courier_fee_mdl into v_fee2 from public.orders where id = v_o;
  select count(*) into n from public.courier_cash_movements where order_id = v_o and kind = 'collected';
  if n <> 1 then raise exception 'FAIL 156.D3: % cash movements for one delivery confirmed twice', n; end if;
  if v_fee2 is distinct from v_fee then raise exception 'FAIL 156.D3: fee changed on the replay (% -> %)', v_fee, v_fee2; end if;
  select count(*) into n from public.delivery_status_events where order_id = v_o and status = 'delivered';
  if n <> 1 then raise exception 'FAIL 156.D3: % delivered events', n; end if;
  raise notice 'PASS 156.D3: double delivery confirm = one cash movement (% MDL fee kept), one event', v_fee;

  -- ===== D4: a late replay of an older step does not move the order backwards =====
  set local role authenticated;
  begin
    perform public.advance_delivery_status(v_o, 'picked_up');
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
  end;
  reset role;
  select status into v_st from public.orders where id = v_o;
  if v_st <> 'delivered' then raise exception 'FAIL 156.D4: a late picked_up moved the order to %', v_st; end if;
  raise notice 'PASS 156.D4: late replay refused (%), order stays delivered', coalesce(v_msg, 'no-op');
end $$;
