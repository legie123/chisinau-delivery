-- 104 (CROSS, written by CLIENT, fixes RESTAURANT + CURIER behaviour): the customer app relies on a
-- push for every milestone another sector triggers. Restaurant accept / reject and courier
-- picked_up / delivered must each enqueue exactly one customer notification with the order tag.
-- Red here = the emitting sector fixes its code (interconnection rules), the test is not edited.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_staff uuid := 'a0000000-0000-0000-0000-000000000003';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid;
  v_item uuid; v_qty int; v_addr uuid; v_items jsonb; v_a uuid; v_b uuid;
  x record;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  update public.restaurants set accepting_orders = true, is_active = true where id = v_rest;
  select mi.id, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int into v_item, v_qty
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and (mi.sold_out_until is null or mi.sold_out_until <= now())
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng)
  values (v_cust, 'sim104', '+37360000000', 47.0250, 28.8330) returning id into v_addr;
  v_items := jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty));

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  v_a := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
           p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim104-a');
  v_b := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
           p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim104-b');

  -- RESTAURANT emits: accept A, reject B
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform public.accept_order(v_a);
  perform public.reject_order(v_b, 'Ingredient lipsă');
  perform public.mark_ready_for_pickup(v_a);

  -- CURIER emits: picked_up, then delivered (assignment forced: dispatch is not under test here)
  perform set_config('request.jwt.claims', null, true);
  update public.orders set courier_id = v_courier, status = 'courier_assigned' where id = v_a;
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user, 'role', 'authenticated')::text, true);
  perform public.advance_delivery_status(v_a, 'picked_up', false);
  perform public.advance_delivery_status(v_a, 'en_route', false);
  perform public.advance_delivery_status(v_a, 'delivered', true);
  perform set_config('request.jwt.claims', null, true);

  for x in select * from (values
      (v_a, 'Comanda a fost acceptată%', 'restaurant accept'),
      (v_b, 'Comanda a fost refuzată%', 'restaurant reject'),
      (v_a, 'Curierul a ridicat comanda%', 'courier picked_up'),
      (v_a, 'Comandă livrată%', 'courier delivered')) t(oid, title, who)
  loop
    if (select count(*) from public.notification_outbox
         where user_id = v_cust and tag = 'order-' || x.oid::text and title like x.title) <> 1 then
      raise exception 'FAIL 104: % did not enqueue exactly one customer push (%)', x.who, x.title;
    end if;
  end loop;
  raise notice 'PASS 104: accept, reject, picked_up and delivered each push the customer once';
end $$;
