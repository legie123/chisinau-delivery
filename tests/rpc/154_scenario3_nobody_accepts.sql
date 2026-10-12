-- System scenario 3 (gate I3): nobody accepts — the offer expires and nothing is left hanging.
-- Existing behaviour pinned end to end through the real dispatch_order + expire_dispatch_offers (the pg_cron
-- sweeper): offer to the closest courier -> expires -> cascades to the next one -> expires -> no live offer left,
-- the order is still ready_for_pickup with no courier, both couriers are back online (not stuck), ops sees it in
-- admin_stuck_orders, and the next eligible courier who comes online gets it.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_rlat numeric; v_rlng numeric; v_addr uuid;
  v_a uuid; v_b uuid; v_c uuid; v_o uuid; v_off uuid; v_to uuid; n int; v_st text; v_courier uuid;
begin
  select id, lat, lng into v_rest, v_rlat, v_rlng from public.restaurants where is_active and lat is not null order by name limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 154', v_rlat + 0.01, v_rlng) returning id into v_addr;
  update public.couriers set status = 'offline' where status = 'online';
  select id into v_a from public.couriers where is_active and public.courier_has_capacity(id) order by id limit 1;
  select id into v_b from public.couriers where is_active and public.courier_has_capacity(id) and id <> v_a order by id limit 1;
  select id into v_c from public.couriers where is_active and public.courier_has_capacity(id) and id not in (v_a, v_b) order by id limit 1;
  if v_c is null then raise exception 'FAIL 154.setup: need three couriers with capacity'; end if;
  update public.couriers set status = 'online', vehicle_type = 'bike' where id in (v_a, v_b);
  update public.dispatch_offers set status = 'declined' where courier_id in (v_a, v_b, v_c) and status = 'offered';
  delete from public.courier_locations where courier_id in (v_a, v_b, v_c);
  insert into public.courier_locations (courier_id, lat, lng, is_plausible)
  values (v_a, v_rlat + 0.005, v_rlng, true), (v_b, v_rlat + 0.02, v_rlng, true);
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230, now() - interval '5 minutes')
  returning id into v_o;

  -- ===== N1: the first offer goes to the closest courier =====
  v_off := public.dispatch_order(v_o);
  select courier_id into v_to from public.dispatch_offers where id = v_off;
  if v_to is distinct from v_a then raise exception 'FAIL 154.N1: first offer went to % (expected the closest)', v_to; end if;
  raise notice 'PASS 154.N1: first offer to the closest courier';

  -- ===== N2: ignored -> expired by the sweeper -> cascades to the next courier =====
  update public.dispatch_offers set expires_at = now() - interval '1 second' where order_id = v_o and status = 'offered';
  perform public.expire_dispatch_offers();
  select status into v_st from public.dispatch_offers where id = v_off;
  select courier_id into v_to from public.dispatch_offers where order_id = v_o and status = 'offered';
  if v_st <> 'expired' or v_to is distinct from v_b then raise exception 'FAIL 154.N2: first offer % / live offer to % (expected expired / next courier)', v_st, v_to; end if;
  raise notice 'PASS 154.N2: expired offer cascades to the next courier';

  -- ===== N3: nobody accepts — nothing left hanging =====
  update public.dispatch_offers set expires_at = now() - interval '1 second' where order_id = v_o and status = 'offered';
  perform public.expire_dispatch_offers();
  select count(*) into n from public.dispatch_offers where order_id = v_o and status = 'offered';
  if n <> 0 then raise exception 'FAIL 154.N3: % live offer(s) left on the order', n; end if;
  select count(*) into n from public.dispatch_offers where order_id = v_o and status = 'offered' and expires_at < now();
  if n <> 0 then raise exception 'FAIL 154.N3: an expired offer is still marked offered'; end if;
  select status, courier_id into v_st, v_courier from public.orders where id = v_o;
  if v_st <> 'ready_for_pickup' or v_courier is not null then raise exception 'FAIL 154.N3: order became % / courier %', v_st, v_courier; end if;
  select count(*) into n from public.couriers where id in (v_a, v_b) and status = 'online';
  if n <> 2 then raise exception 'FAIL 154.N3: an ignoring courier is no longer online (% of 2)', n; end if;
  raise notice 'PASS 154.N3: no live or dangling offer; order still ready, unassigned; couriers back online';

  -- ===== N4: ops sees it (ready > 3 min, no recent offer) =====
  update public.dispatch_offers set expires_at = now() - interval '2 minutes' where order_id = v_o;
  perform set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
  set local role authenticated;   -- read it as ops does (admin_order_board filters on platform_admin)
  select count(*) into n from public.admin_stuck_orders where id = v_o;
  reset role;
  if n <> 1 then raise exception 'FAIL 154.N4: stuck view shows the order % time(s)', n; end if;
  raise notice 'PASS 154.N4: the order is in admin_stuck_orders';

  -- ===== N5: the next eligible courier who comes online gets it (the sweeper rescues undispatched orders) =====
  update public.couriers set status = 'online', vehicle_type = 'bike' where id = v_c;
  insert into public.courier_locations (courier_id, lat, lng, is_plausible) values (v_c, v_rlat + 0.003, v_rlng, true);
  perform public.expire_dispatch_offers();
  select courier_id into v_to from public.dispatch_offers where order_id = v_o and status = 'offered';
  if v_to is distinct from v_c then raise exception 'FAIL 154.N5: live offer to % (expected the newly online courier)', v_to; end if;
  raise notice 'PASS 154.N5: a newly online courier is offered the order';
end $$;
