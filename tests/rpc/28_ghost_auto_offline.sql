-- Order 7 — ghost auto-offline (20260727001400). A courier who lets 3
-- CONSECUTIVE offers expire (never responds) gets demoted offline by the
-- sweeper itself. Declines never count towards the streak and never reset
-- it either (only a decline itself was previously untouched); an accept, or
-- the courier manually going back online, resets it to 0. Rolled back by
-- the runner.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier_user uuid := 'c0000000-0000-0000-0000-000000000007';
  v_courier uuid;
  v_item uuid; v_addr uuid;
  v_oid uuid; v_offer uuid;
  v_streak int; v_status text; v_shift_open boolean; v_notif_count int;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;

  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- isolate: only v_courier is a dispatch candidate
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  update public.couriers set status = 'offline' where id <> v_courier;
  update public.courier_shifts set ended_at = now() where courier_id = v_courier and ended_at is null;
  delete from public.notification_outbox where user_id = v_courier_user;
  update public.couriers set status = 'offline', consecutive_ignored_offers = 0 where id = v_courier;

  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.set_courier_online_status('online');

  -- ===== phase 1: decline never counts and never resets =====
  -- ignore #1
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offer is null then raise exception 'FAIL: phase1 ignore#1 — no offer fired'; end if;
  update public.dispatch_offers set expires_at = now() - interval '1 second' where id = v_offer;
  perform public.expire_dispatch_offers();
  select consecutive_ignored_offers into v_streak from public.couriers where id = v_courier;
  if v_streak <> 1 then raise exception 'FAIL: phase1 after ignore#1 streak=% (expected 1)', v_streak; end if;

  -- a real decline in between — must not count and must not reset
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offer is null then raise exception 'FAIL: phase1 decline setup — no offer fired'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.decline_dispatch_offer(v_offer);
  select consecutive_ignored_offers, status into v_streak, v_status from public.couriers where id = v_courier;
  if v_streak <> 1 then raise exception 'FAIL: decline changed the streak (now %, expected still 1)', v_streak; end if;
  if v_status <> 'online' then raise exception 'FAIL: a lone decline demoted the courier (status %)', v_status; end if;

  raise notice 'PASS ghost-auto-offline phase1: decline did not count and did not reset (streak=1)';

  -- ===== phase 2: a fresh accept breaks the streak =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offer is null then raise exception 'FAIL: phase2 accept setup — no offer fired'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.accept_dispatch_offer(v_offer);
  select consecutive_ignored_offers into v_streak from public.couriers where id = v_courier;
  if v_streak <> 0 then raise exception 'FAIL: accept did not reset the streak (now %)', v_streak; end if;

  -- free the courier back up (test fixture cleanup, not part of the assertion)
  update public.orders set status = 'cancelled', courier_id = null where id = v_oid;
  update public.couriers set status = 'online' where id = v_courier;

  raise notice 'PASS ghost-auto-offline phase2: a fresh accept reset the streak to 0';

  -- ===== phase 3: 3 consecutive ignored offers -> auto-offline =====
  for i in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
    v_oid := public.place_order(v_rest, 'standard', 'cash',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
    perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
    perform public.accept_order(v_oid);
    perform public.mark_ready_for_pickup(v_oid);
    select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
    if v_offer is null then raise exception 'FAIL: phase3 ignore#% — no offer fired', i; end if;
    update public.dispatch_offers set expires_at = now() - interval '1 second' where id = v_offer;
    perform public.expire_dispatch_offers();
  end loop;

  select consecutive_ignored_offers, status into v_streak, v_status from public.couriers where id = v_courier;
  if v_status <> 'offline' then raise exception 'FAIL: courier still % after 3 consecutive ignored offers', v_status; end if;
  if v_streak <> 0 then raise exception 'FAIL: streak not reset after auto-offline (now %)', v_streak; end if;

  select not exists (select 1 from public.courier_shifts where courier_id = v_courier and ended_at is null)
  into v_shift_open;
  if not v_shift_open then raise exception 'FAIL: shift still open after auto-offline'; end if;

  select count(*) into v_notif_count from public.notification_outbox
  where user_id = v_courier_user and tag = 'dispatch'
    and body = 'Te-am trecut offline după 3 oferte ratate — revino online când ești gata.';
  if v_notif_count < 1 then raise exception 'FAIL: no auto-offline notification row (tag=dispatch)'; end if;

  raise notice 'PASS ghost-auto-offline phase3: 3 consecutive ignores -> offline, shift closed, streak reset, notice queued';

  -- ===== phase 4: manual online reset breaks the streak =====
  update public.couriers set consecutive_ignored_offers = 2 where id = v_courier; -- simulate a leftover streak
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.set_courier_online_status('online');
  select consecutive_ignored_offers, status into v_streak, v_status from public.couriers where id = v_courier;
  if v_status <> 'online' then raise exception 'FAIL: manual online did not take effect (status %)', v_status; end if;
  if v_streak <> 0 then raise exception 'FAIL: manual online did not reset the streak (now %)', v_streak; end if;

  perform 1 from public.courier_shifts where courier_id = v_courier and ended_at is null;
  if not found then raise exception 'FAIL: manual online did not open a fresh shift'; end if;

  raise notice 'PASS ghost-auto-offline phase4: manual online reset the streak to 0 and opened a fresh shift';
end $$;
