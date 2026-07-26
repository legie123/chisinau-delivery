-- Full lifecycle through the REAL RPCs (audit #26/#27): place → accept → ready →
-- dispatch_order scoring → accept_dispatch_offer → picked_up → en_route → delivered
-- → ratings; plus the offer-expiry sweeper. Runs against the seeded LOCAL db,
-- wrapped in BEGIN/ROLLBACK by the runner — nothing persists.

-- ===== L1: happy path, every hop through its RPC =====
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';       -- Sakura (partner a...03 is staff)
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid; v_item uuid; v_addr uuid; v_oid uuid; v_offer uuid;
  v_status text; v_pay text; v_dat timestamptz; v_ratings int;
begin
  -- Arrange: open hours, an available item, the courier online + near the restaurant,
  -- and ONLY this courier as a dispatch candidate (others parked offline).
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  select id into v_courier from public.couriers where user_id = v_courier_user;
  -- free the candidate of any seeded active deliveries (capacity gate) — sim-only, rolled back
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  update public.couriers set status = 'offline' where id <> v_courier;
  update public.couriers set status = 'online', is_active = true where id = v_courier;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier, 47.0245, 28.8322, now())
  on conflict (courier_id) do update set lat = 47.0245, lng = 28.8322, updated_at = now();

  -- 1. customer places
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  -- qty 1 (not 10): stays comfortably under the pilot cash-float cap (order 1,
  -- 20260727000800) so this lifecycle test isn't incidentally cross-tripped by
  -- the cash-cap auto-offline — that mechanism has its own coverage in
  -- tests/rpc/22_cash_float.sql.
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);

  -- 2. partner accepts, 3. marks ready (fires dispatch_order → offer to our courier)
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);

  select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offer is null then raise exception 'FAIL L1: dispatch fired no offer to the only online courier'; end if;

  -- 4. courier accepts the offer, 5-7. advances to delivered (cash confirmed)
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.accept_dispatch_offer(v_offer);
  perform public.advance_delivery_status(v_oid, 'picked_up', null);
  perform public.advance_delivery_status(v_oid, 'en_route', null);
  perform public.advance_delivery_status(v_oid, 'delivered', true);

  select status, payment_status, delivered_at into v_status, v_pay, v_dat from public.orders where id = v_oid;
  if v_status <> 'delivered' then raise exception 'FAIL L1: final status % (expected delivered)', v_status; end if;
  if v_pay <> 'paid' then raise exception 'FAIL L1: payment_status % (expected paid, cash confirmed)', v_pay; end if;
  if v_dat is null then raise exception 'FAIL L1: delivered_at not stamped'; end if;
  select status into v_status from public.couriers where id = v_courier;
  if v_status <> 'online' then raise exception 'FAIL L1: courier not released back online (%)', v_status; end if;

  -- 8. customer rates both sides
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  perform public.submit_rating(v_oid, 'restaurant', 5, 'excelent');
  perform public.submit_rating(v_oid, 'courier', 5, 'rapid');
  select count(*) into v_ratings from public.ratings where order_id = v_oid;
  if v_ratings <> 2 then raise exception 'FAIL L1: % ratings persisted (expected 2)', v_ratings; end if;

  raise notice 'PASS L1: full RPC lifecycle place→accept→ready→offer→accept→delivered(paid,stamped)→rated(2), courier released';
end $$;

-- ===== L2: expiry sweeper expires a stale offer and cascades =====
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_cA uuid; v_cB uuid; v_item uuid; v_addr uuid; v_oid uuid; v_offer uuid;
  v_status text; v_next int;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- two online candidates near the restaurant → wave 1 goes to one, cascade has a next hop
  select id into v_cA from public.couriers where user_id = 'a0000000-0000-0000-0000-000000000002';
  select id into v_cB from public.couriers where id <> v_cA limit 1;
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id in (v_cA, v_cB) and status in ('courier_assigned','picked_up','en_route');
  update public.couriers set status = 'offline' where id not in (v_cA, v_cB);
  update public.couriers set status = 'online', is_active = true where id in (v_cA, v_cB);
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_cA, 47.0245, 28.8322, now()), (v_cB, 47.03, 28.84, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 10)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);

  select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offer is null then raise exception 'FAIL L2: no wave-1 offer'; end if;

  -- age the offer past its window, run the sweeper (as the cron would)
  update public.dispatch_offers set expires_at = now() - interval '1 second' where id = v_offer;
  perform set_config('request.jwt.claims', '', true);
  perform public.expire_dispatch_offers();

  select status into v_status from public.dispatch_offers where id = v_offer;
  if v_status <> 'expired' then raise exception 'FAIL L2: stale offer status % (expected expired)', v_status; end if;
  -- cascade: a NEW live offer to the other candidate (or at minimum the order rescued, still unassigned)
  select count(*) into v_next from public.dispatch_offers where order_id = v_oid and status = 'offered' and id <> v_offer;
  select status into v_status from public.orders where id = v_oid;
  if v_next = 0 and v_status <> 'ready_for_pickup' then
    raise exception 'FAIL L2: no cascade offer AND order left in %', v_status;
  end if;
  raise notice 'PASS L2: sweeper expired the stale offer (cascade offers=% order=%)', v_next, v_status;
end $$;
