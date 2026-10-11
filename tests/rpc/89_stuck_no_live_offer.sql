-- Ops sees an undispatchable order in minutes, not 15 (migration 20261011000200_stuck_no_live_offer).
-- admin_stuck_orders listed a ready_for_pickup order only after 15 minutes, whatever the reason.
-- Now: ready for 3+ minutes with no live offer -> listed ("Fără ofertă activă"); any recorded
-- dispatch failure (dispatch_errors, sim 88) -> listed at once with the error. A ready order that
-- has a live offer, or is younger than 3 minutes without errors, stays out.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_addr uuid; v_admin uuid; v_courier uuid;
  v_no_offer uuid; v_live_offer uuid; v_err uuid; v_young uuid; v_reason text;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select id into v_courier from public.couriers order by id limit 1;
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 89', 47.02, 28.83)
  returning id into v_addr;

  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230, now() - interval '4 minutes')
  returning id into v_no_offer;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230, now() - interval '4 minutes')
  returning id into v_live_offer;
  insert into public.dispatch_offers (order_id, courier_id, score, status, expires_at)
  values (v_live_offer, v_courier, 1, 'offered', now() + interval '20 seconds');
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230, now() - interval '1 minute')
  returning id into v_err;
  insert into public.dispatch_errors (order_id, phase, error_code, message, count)
  values (v_err, 'sweep', 'P0089', 'sim89 boom', 3);
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230, now() - interval '1 minute')
  returning id into v_young;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ===== S1: 4 min, no live offer -> listed =====
  select stuck_reason into v_reason from public.admin_stuck_orders where id = v_no_offer;
  if v_reason is null or v_reason not like 'Fără ofertă activă%' then
    raise exception 'FAIL 89.S1: ready 4 min with no offer not listed as such (reason %)', v_reason;
  end if;
  raise notice 'PASS 89.S1: no live offer after 3 min is listed (%)', v_reason;

  -- ===== S2: a live offer keeps it out =====
  if exists (select 1 from public.admin_stuck_orders where id = v_live_offer) then
    raise exception 'FAIL 89.S2: order with a live offer listed as stuck';
  end if;
  raise notice 'PASS 89.S2: live offer -> not stuck';

  -- ===== S3: a recorded dispatch failure is listed at once, with the error =====
  select stuck_reason into v_reason from public.admin_stuck_orders where id = v_err;
  if v_reason is null or v_reason not like '%sim89 boom%' or v_reason not like '%3%' then
    raise exception 'FAIL 89.S3: dispatch failure not surfaced (reason %)', v_reason;
  end if;
  raise notice 'PASS 89.S3: dispatch failure surfaced at once (%)', v_reason;

  -- ===== S4: 1 min, no errors -> grace, not listed =====
  if exists (select 1 from public.admin_stuck_orders where id = v_young) then
    raise exception 'FAIL 89.S4: 1-minute-old ready order listed';
  end if;
  raise notice 'PASS 89.S4: young order without errors not listed';
  reset role;
end $$;
