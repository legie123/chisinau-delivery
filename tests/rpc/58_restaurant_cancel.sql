-- restaurant_cancel_order — dezbatere 2026-08-12 GAP (P1): partner bail-out
-- post-accept. RC1 happy: accepted -> cancelled + event + customer notified +
-- live offer killed. RC2: blocked after courier pickup. RC3: staff-only.
-- RC4: reason mandatory.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid; v_item uuid; v_addr uuid; v_oid uuid;
  v_status text; v_n int; v_offer uuid;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  select id into v_courier from public.couriers where user_id = v_courier_user;
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_courier, 'refund_reversal', -public.courier_cash_balance(v_courier), 'sim baseline (rolled back)'
  where public.courier_cash_balance(v_courier) > 0;
  update public.couriers set status = 'online', is_active = true, consecutive_ignored_offers = 0 where id = v_courier;
  update public.couriers set status = 'offline' where id <> v_courier;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier, 47.0245, 28.8322, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();

  -- RC1: accepted -> ready (offer fires) -> restaurant bails out
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
  perform public.restaurant_cancel_order(v_oid, 'S-a terminat somonul proaspăt');
  perform set_config('request.jwt.claims', null, true);

  select status into v_status from public.orders where id = v_oid;
  if v_status <> 'cancelled' then raise exception 'FAIL RC1: status % (expected cancelled)', v_status; end if;
  select count(*) into v_n from public.delivery_status_events
  where order_id = v_oid and status='cancelled' and actor_role='restaurant_partner';
  if v_n <> 1 then raise exception 'FAIL RC1b: missing partner cancel event'; end if;
  select count(*) into v_n from public.notification_outbox where user_id = v_cust and url = '/orders/'||v_oid
    and title like '%anulată de restaurant%';
  if v_n <> 1 then raise exception 'FAIL RC1c: customer was not notified'; end if;
  if v_offer is not null then
    select count(*) into v_n from public.dispatch_offers where id = v_offer and status = 'offered';
    if v_n <> 0 then raise exception 'FAIL RC1d: live offer survived the cancel'; end if;
  end if;
  raise notice 'PASS RC1: partner bail-out cancels, notifies, and kills the live offer';

  -- RC2: after pickup -> blocked
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  select id into v_offer from public.dispatch_offers where order_id = v_oid and status='offered';
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.accept_dispatch_offer(v_offer);
  perform public.advance_delivery_status(v_oid, 'picked_up', null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  begin
    perform public.restaurant_cancel_order(v_oid, 'prea târziu oricum');
    raise exception 'FAIL RC2: cancel allowed after courier pickup';
  exception when others then
    if sqlerrm like 'FAIL RC2%' then raise; end if;
    raise notice 'PASS RC2: blocked after pickup (%)', sqlerrm;
  end;
  perform set_config('request.jwt.claims', null, true);

  -- RC3: a customer cannot call it
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  begin
    perform public.restaurant_cancel_order(v_oid, 'nu sunt restaurantul');
    raise exception 'FAIL RC3: non-staff caller allowed';
  exception when others then
    if sqlerrm like 'FAIL RC3%' then raise; end if;
    raise notice 'PASS RC3: staff-only enforced (%)', sqlerrm;
  end;
  perform set_config('request.jwt.claims', null, true);

  -- RC4: reason mandatory
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  begin
    perform public.restaurant_cancel_order(v_oid, '  ');
    raise exception 'FAIL RC4: empty reason accepted';
  exception when others then
    if sqlerrm like 'FAIL RC4%' then raise; end if;
    raise notice 'PASS RC4: reason is mandatory (%)', sqlerrm;
  end;
end $$;
