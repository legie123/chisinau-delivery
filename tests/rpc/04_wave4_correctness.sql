-- Wave 4 backend sims. BEGIN/ROLLBACK — nothing persists.

-- ===== S29: standard order w/o address rejected; foreign address rejected; own ok =====
do $$
declare v_rest uuid; v_item uuid; v_raised boolean; v_oid uuid; v_addr uuid; v_other_addr uuid;
begin
  -- pick an open-now restaurant with an available non-catering item (force hours open below)
  select r.id into v_rest from public.restaurants r where r.is_active and r.accepting_orders limit 1;
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  select id into v_addr from public.addresses where customer_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  -- an address that belongs to someone else
  insert into public.addresses (customer_id, street_address) values ('a0000000-0000-0000-0000-000000000002', 'Str. Altcuiva 1') returning id into v_other_addr;

  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);

  -- no address
  v_raised := false;
  begin
    v_oid := public.place_order(v_rest, 'standard', 'cash', jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 10)), null, null, null, null);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL S29a: order placed with NO address'; end if;

  -- someone else's address
  v_raised := false;
  begin
    v_oid := public.place_order(v_rest, 'standard', 'cash', jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 10)), v_other_addr, null, null, null);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL S29b: order placed with a FOREIGN address'; end if;

  -- own address, open restaurant → succeeds
  v_oid := public.place_order(v_rest, 'standard', 'cash', jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 10)), v_addr, null, null, null);
  if v_oid is null then raise exception 'FAIL S29c: valid order did not go through'; end if;
  raise notice 'PASS S29: no-address + foreign-address rejected, own address accepted';
end $$;

-- ===== S18: closed restaurant rejects immediate order; scheduled-inside-hours ok =====
do $$
declare v_rest uuid; v_item uuid; v_raised boolean; v_oid uuid; v_addr uuid; v_tomorrow_noon timestamptz;
begin
  select r.id into v_rest from public.restaurants r where r.is_active and r.accepting_orders limit 1;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  select id into v_addr from public.addresses where customer_id = 'a0000000-0000-0000-0000-000000000001' limit 1;

  -- force ALL days closed
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '10:00'::time, '22:00'::time, true from generate_series(0,6) d;

  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  v_raised := false;
  begin
    v_oid := public.place_order(v_rest, 'standard', 'cash', jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 10)), v_addr, null, null, null);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL S18a: order landed in a CLOSED kitchen'; end if;

  -- reopen 10:00-22:00 every day; schedule tomorrow noon → inside hours → ok
  update public.restaurant_hours set is_closed = false where restaurant_id = v_rest;
  v_tomorrow_noon := ((current_date + 1)::timestamp + time '12:00') at time zone 'Europe/Chisinau';
  v_oid := public.place_order(v_rest, 'standard', 'cash', jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 10)), v_addr, v_tomorrow_noon, null, null);
  if v_oid is null then raise exception 'FAIL S18b: scheduled-inside-hours order rejected'; end if;
  raise notice 'PASS S18: closed-now rejected, scheduled-inside-hours accepted';
end $$;

-- ===== S16: pull-claim blocked while another courier holds a live offer =====
do $$
declare v_rest uuid; v_oid uuid; v_addr uuid; v_item uuid; v_raised boolean;
        v_cA uuid; v_cB uuid; v_uB uuid := 'a0000000-0000-0000-0000-000000000002';
begin
  select r.id into v_rest from public.restaurants r where r.is_active limit 1;
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  select id into v_addr from public.addresses where customer_id = 'a0000000-0000-0000-0000-000000000001' limit 1;

  -- courier B = the test courier user; courier A = any other seeded courier
  select id into v_cB from public.couriers where user_id = v_uB;
  select id into v_cA from public.couriers where id <> v_cB limit 1;
  update public.couriers set status = 'online', is_active = true where id in (v_cA, v_cB);

  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash', jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 10)), v_addr, null, null, null);
  update public.orders set status = 'ready_for_pickup' where id = v_oid; -- superuser shortcut to the claimable state
  -- live offer to courier A
  insert into public.dispatch_offers (order_id, courier_id, status, expires_at, wave, score)
  values (v_oid, v_cA, 'offered', now() + interval '30 seconds', 1, 100);

  -- courier B tries the pull path → must be blocked
  perform set_config('request.jwt.claims', json_build_object('sub', v_uB::text,'role','authenticated')::text, true);
  v_raised := false;
  begin
    perform public.assign_courier(v_oid);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL S16: pull path sniped an order under a live foreign offer'; end if;
  raise notice 'PASS S16: pull-claim blocked while another courier holds the live offer';
end $$;

-- ===== S30/S52: toggle guarded mid-delivery; offline declines live offers =====
do $$
declare v_cB uuid; v_uB uuid := 'a0000000-0000-0000-0000-000000000002'; v_raised boolean;
        v_status text; v_declined int; v_rest uuid; v_oid uuid; v_addr uuid; v_item uuid;
begin
  select id into v_cB from public.couriers where user_id = v_uB;
  update public.couriers set status = 'on_delivery', is_active = true where id = v_cB;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uB::text,'role','authenticated')::text, true);
  v_raised := false;
  begin
    perform public.set_courier_online_status('offline');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL S30: toggle overwrote on_delivery'; end if;

  -- back online + a live offer, then go offline → offer declined
  update public.couriers set status = 'online' where id = v_cB;
  select r.id into v_rest from public.restaurants r where r.is_active limit 1;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select id into v_addr from public.addresses where customer_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash', jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 10)), v_addr, null, null, null);
  update public.orders set status = 'ready_for_pickup' where id = v_oid;
  insert into public.dispatch_offers (order_id, courier_id, status, expires_at, wave, score)
  values (v_oid, v_cB, 'offered', now() + interval '30 seconds', 1, 100);

  perform set_config('request.jwt.claims', json_build_object('sub', v_uB::text,'role','authenticated')::text, true);
  perform public.set_courier_online_status('offline');
  select status into v_status from public.couriers where id = v_cB;
  select count(*) into v_declined from public.dispatch_offers where courier_id = v_cB and order_id = v_oid and status = 'declined';
  if v_status <> 'offline' then raise exception 'FAIL S52: courier not offline'; end if;
  if v_declined <> 1 then raise exception 'FAIL S52: live offer not declined on offline'; end if;
  raise notice 'PASS S30/S52: mid-delivery toggle blocked; offline declines the live offer';
end $$;

-- ===== S44: onboarding economics clamped + slug sanitized/uniquified =====
do $$
declare v_app uuid; v_fee numeric; v_min numeric; v_slug text; v_existing text;
begin
  select slug into v_existing from public.restaurants limit 1;
  insert into public.onboarding_applications (user_id, applicant_type, status, full_name, phone, details)
  values ('a0000000-0000-0000-0000-000000000001', 'restaurant', 'pending', 'Test Aplicant', '+37360000009',
          jsonb_build_object('name', 'Hack Shop', 'slug', v_existing, 'delivery_fee_mdl', 99999, 'min_order_amount_mdl', -50, 'avg_prep_minutes', 1, 'cuisine_type', 'evil'))
  returning id into v_app;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  perform public.review_onboarding_application(v_app, true, 'sim');
  select delivery_fee_mdl, min_order_amount_mdl, slug into v_fee, v_min, v_slug
  from public.restaurants where name = 'Hack Shop';
  if v_fee <> 200 then raise exception 'FAIL S44: fee not clamped (%)', v_fee; end if;
  if v_min <> 0 then raise exception 'FAIL S44: min not clamped (%)', v_min; end if;
  if v_slug = v_existing then raise exception 'FAIL S44: slug collision not uniquified'; end if;
  raise notice 'PASS S44: economics clamped (fee=200, min=0), slug uniquified (%)', v_slug;
end $$;

-- ===== S45: outbox claim is exclusive — second immediate claim gets nothing =====
do $$
declare v_n1 int; v_n2 int;
begin
  insert into public.notification_outbox (user_id, title, body, url)
  values ('a0000000-0000-0000-0000-000000000001', 'Sim', 'claim test', '/'),
         ('a0000000-0000-0000-0000-000000000001', 'Sim2', 'claim test 2', '/');
  select count(*) into v_n1 from public.claim_notification_outbox(50);
  select count(*) into v_n2 from public.claim_notification_outbox(50);
  if v_n1 < 2 then raise exception 'FAIL S45: first claim got % rows (expected >=2)', v_n1; end if;
  if v_n2 <> 0 then raise exception 'FAIL S45: second claim re-claimed % rows (expected 0)', v_n2; end if;
  raise notice 'PASS S45: claim exclusive (first=% second=0)', v_n1;
end $$;
