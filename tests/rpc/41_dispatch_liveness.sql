-- DispatchAudit fixes (20260731000400): #2 the wave-round window lets a courier
-- who comes online AFTER a spent 5-wave burst rescue a stalled ready order;
-- admin_assign_courier rescues a fully-canvassed courier-less order manually.
-- (Deadlock catches are structural — verified by reading the recreated bodies,
-- not deterministically reproducible single-session.) Rolled back by the runner.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_ux uuid := 'c0000000-0000-0000-0000-000000000003'; -- courier X (gets the burst)
  v_uy uuid := 'c0000000-0000-0000-0000-000000000006'; -- courier Y (arrives later)
  v_cx uuid; v_cy uuid; v_item uuid; v_addr uuid; v_oid uuid; v_won uuid; n int; v_status text; v_ord_c uuid;
begin
  select id into v_cx from public.couriers where user_id = v_ux;
  select id into v_cy from public.couriers where user_id = v_uy;

  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  update public.restaurants set min_order_amount_mdl = 0 where id = v_rest;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- Neutralize the pre-existing unassigned ready demo fixtures (C/V) — otherwise
  -- the rescue loop hands courier Y one of THEM (capacity 1) instead of our test
  -- order, and the assertion below sees no offer on v_oid.
  update public.orders set status = 'cancelled'
    where status = 'ready_for_pickup' and courier_id is null;
  -- Only X online; Y offline for now. Clear their live offers/active orders.
  update public.orders set status = 'cancelled', courier_id = null
    where courier_id in (v_cx, v_cy) and status in ('courier_assigned','picked_up','en_route');
  update public.couriers set status = 'offline';
  update public.couriers set status = 'online', is_active = true, consecutive_ignored_offers = 0 where id = v_cx;
  update public.dispatch_offers set status = 'cancelled' where courier_id in (v_cx, v_cy) and status = 'offered';
  insert into public.courier_locations (courier_id, lat, lng, updated_at) values
    (v_cx, 47.02, 28.83, now()), (v_cy, 47.03, 28.84, now())
    on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now(), is_plausible = true;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid); -- dispatch → 1 offer to X

  -- Age that spent burst: the offer is 20 min old, expired, and wave=5 (budget spent).
  update public.dispatch_offers
    set status = 'expired', wave = 5, created_at = now() - interval '20 minutes', expires_at = now() - interval '19 minutes'
    where order_id = v_oid;

  -- Under the OLD lifetime cap: max(wave)=5 → next wave=6 → dead forever, even
  -- though Y (online now, never offered this order) is a perfect candidate.
  update public.couriers set status = 'online', is_active = true, consecutive_ignored_offers = 0 where id = v_cy;
  perform public.expire_dispatch_offers(); -- rescue loop must re-offer to Y

  select courier_id into v_won from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_won is null then raise exception 'FAIL: stalled order not rescued after wave-round window'; end if;
  if v_won <> v_cy then raise exception 'FAIL: rescued to the wrong courier (% not Y)', v_won; end if;

  -- admin_assign_courier: the fully-canvassed / manual path
  update public.dispatch_offers set status = 'cancelled' where order_id = v_oid and status = 'offered';
  update public.orders set status = 'ready_for_pickup', courier_id = null where id = v_oid;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  n := 0;
  begin perform public.admin_assign_courier(v_oid, v_cy); exception when others then n := 1; end;
  if n <> 1 then raise exception 'FAIL: non-admin assigned a courier'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.admin_assign_courier(v_oid, v_cy);
  select status, courier_id into v_status, v_ord_c from public.orders where id = v_oid;
  if v_status <> 'courier_assigned' or v_ord_c <> v_cy then
    raise exception 'FAIL: admin_assign_courier did not place the courier (% / %)', v_status, v_ord_c;
  end if;

  raise notice 'PASS dispatch-liveness: late-arriving courier rescues a spent-burst order; admin_assign_courier places manually (admin-only)';
end $$;
