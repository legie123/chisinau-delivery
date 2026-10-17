-- Pin rule A, ADMIN half (migration 20261012000494_restaurant_pin_guards). Owner decision 2026-10-12/13:
-- the restaurant pin is frozen while orders are in flight (B1: a pin moved 5 km farther between
-- "ready" and "delivered" paid the courier +71 % for a distance nobody drove), and activation needs a
-- pin the partner confirmed (confirm_restaurant_pin, 000308). Consumer of mark_ready_for_pickup /
-- advance_delivery_status (CURIER/RESTAURANT) — untouched, the proof is that they pay the quote.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_admin uuid; v_partner uuid; v_rid uuid; v_addr uuid; v_oid uuid; v_err text;
  v_courier uuid; v_courier_user uuid; v_quote numeric; v_paid numeric; v_assumed boolean; v_lat numeric;
begin
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  select id into v_partner from public.profiles where role = 'restaurant_partner' limit 1;
  if v_admin is null or v_partner is null then raise exception 'FAIL 296: seed lacks an admin or a partner profile'; end if;

  -- a fresh, inactive restaurant without a pin (what review_onboarding_application creates), with staff
  insert into public.restaurants (slug, name, cuisine_type, address, phone, is_active, accepting_orders)
  values ('sim-296-pin', 'Sim 296 Pin', 'other', 'Str. Pin 296', '+37360000296', false, true)
  returning id into v_rid;
  insert into public.restaurant_staff (restaurant_id, user_id) values (v_rid, v_partner) on conflict do nothing;

  -- ===== C2: activation without a pin is refused, even with a (forged) confirmation =====
  update public.restaurants set pin_confirmed_at = now() where id = v_rid; -- postgres bypasses the column guard
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin update public.restaurants set is_active = true where id = v_rid; exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null or v_err not like '%activat%' then
    raise exception 'FAIL 296.C2: admin activated a restaurant without lat/lng (%)', coalesce(v_err, 'no error');
  end if;
  raise notice 'PASS 296.C2: activation without a pin refused (%)', v_err;

  -- ===== C1: pin set by the admin but not confirmed by the partner → refused =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.restaurants set lat = 47.0200, lng = 28.8300 where id = v_rid; -- no order in flight: allowed
  reset role;
  update public.restaurants set pin_confirmed_at = null where id = v_rid;
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin update public.restaurants set is_active = true where id = v_rid; exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null or v_err not like '%activat%' then
    raise exception 'FAIL 296.C1: admin activated a restaurant whose pin the partner never confirmed (%)', coalesce(v_err, 'no error');
  end if;
  if (select is_active from public.restaurants where id = v_rid) then raise exception 'FAIL 296.C1: is_active flipped despite the error'; end if;
  raise notice 'PASS 296.C1: activation with pin_confirmed_at null refused (%)', v_err;

  -- ===== D: partner confirms the pin → the admin can activate =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.confirm_restaurant_pin(v_rid);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.restaurants set is_active = true where id = v_rid;
  reset role;
  if not (select is_active from public.restaurants where id = v_rid) then raise exception 'FAIL 296.D: activation with a confirmed pin did not stick'; end if;
  raise notice 'PASS 296.D: confirmed pin → activated';

  -- ===== E (system scenario 8): order ~2 km, ready (quote stamped), admin tries to move the pin 5 km farther =====
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sistem 8', 47.0380, 28.8300)
  returning id into v_addr; -- 0.018° lat ≈ 2.0 km from the pin
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rid, v_addr, 'accepted', 'card_on_delivery', 'unpaid', 200, 30, 230)
  returning id into v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.mark_ready_for_pickup(v_oid); -- stamps courier_fee_quoted_mdl from the 2 km pin
  reset role;
  select courier_fee_quoted_mdl into v_quote from public.orders where id = v_oid;
  if v_quote is null then raise exception 'FAIL 296.E0: mark_ready_for_pickup stamped no quote'; end if;
  select id, user_id into v_courier, v_courier_user from public.couriers where is_active and public.courier_has_capacity(id) order by id limit 1;
  update public.couriers set status = 'on_delivery' where id = v_courier;
  update public.orders set status = 'courier_assigned', courier_id = v_courier where id = v_oid;

  -- E1: the admin panel (setRestaurantLocation = direct update as the admin) is refused
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin update public.restaurants set lat = 46.9750 where id = v_rid; exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null or v_err not like '%comenzi în curs%' then
    raise exception 'FAIL 296.E1: admin moved the pin of a restaurant with an order in flight (%)', coalesce(v_err, 'no error');
  end if;
  if (select lat from public.restaurants where id = v_rid) <> 47.0200 then raise exception 'FAIL 296.E1: the pin moved despite the error'; end if;

  -- E2: the courier delivers; the final fee is exactly the quote (nothing moved under the courier)
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.advance_delivery_status(v_oid, 'picked_up');
  perform public.advance_delivery_status(v_oid, 'en_route');
  perform public.advance_delivery_status(v_oid, 'delivered', true);
  reset role;
  select courier_fee_quoted_mdl, courier_fee_mdl, courier_fee_distance_assumed into v_quote, v_paid, v_assumed
    from public.orders where id = v_oid;
  if v_paid is distinct from v_quote or v_assumed then
    raise exception 'FAIL 296.E2: delivery paid % against a quote of % (distance assumed=%)', v_paid, v_quote, v_assumed;
  end if;
  raise notice 'PASS 296.E: pin move refused in flight (%); delivery paid exactly the quote, % MDL', v_err, v_quote;

  -- ===== A: a ready_for_pickup order freezes the pin even for postgres =====
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rid, v_addr, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230)
  returning id into v_oid;
  v_err := null;
  begin update public.restaurants set lng = 28.8310 where id = v_rid; exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like '%comenzi în curs%' then
    raise exception 'FAIL 296.A: postgres moved the pin with a ready_for_pickup order (%)', coalesce(v_err, 'no error');
  end if;
  raise notice 'PASS 296.A: pin frozen by a ready_for_pickup order (%)', v_err;

  -- ===== B: the same order delivered → the pin moves =====
  update public.orders set status = 'delivered', delivered_at = now() where id = v_oid;
  select lat into v_lat from public.restaurants where id = v_rid;
  update public.restaurants set lat = v_lat + 0.001 where id = v_rid;
  if (select lat from public.restaurants where id = v_rid) <> v_lat + 0.001 then raise exception 'FAIL 296.B: the pin did not move after delivery'; end if;
  raise notice 'PASS 296.B: pin moved once the order is delivered';
end $$;
