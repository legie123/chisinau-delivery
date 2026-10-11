-- 103 (CROSS, written by CLIENT, fixes RESTAURANT behaviour): what the kitchen tablet sets with
-- set_menu_item_sold_out (RESTAURANT, 20261012000303) is exactly what the customer's place_order
-- refuses (CLIENT, 20261012000102). 'today' blocks ASAP but not tomorrow, 'indefinite' blocks
-- tomorrow too, 'off' unblocks. If RESTAURANT changes the semantics, this goes red; per the
-- interconnection rules RESTAURANT fixes its code, it does not edit this test.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_staff uuid := 'a0000000-0000-0000-0000-000000000003';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_qty int; v_addr uuid; v_items jsonb; v_tomorrow timestamptz;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  update public.restaurants set accepting_orders = true, is_active = true where id = v_rest;
  select mi.id, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int into v_item, v_qty
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  update public.menu_items set sold_out_until = null where id = v_item;
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng)
  values (v_cust, 'sim103', '+37360000000', 47.0250, 28.8330) returning id into v_addr;
  v_items := jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty));
  -- tomorrow 12:00 in Chișinău (after any 'today' sold-out has lapsed at local midnight)
  v_tomorrow := ((now() at time zone 'Europe/Chisinau')::date + 1 + time '12:00') at time zone 'Europe/Chisinau';

  -- 103.1 'today' → ASAP refused, tomorrow accepted
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform public.set_menu_item_sold_out(v_item, 'today');
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim103-today-asap');
    raise exception 'FAIL 103.1: tablet said "today" but the customer could order ASAP';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' or sqlerrm not like '%epuizat%' then raise; end if;
  end;
  perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
            p_items => v_items, p_delivery_address_id => v_addr, p_requested_for => v_tomorrow,
            p_idempotency_key => 'sim103-today-tomorrow');
  raise notice 'PASS 103.1: "today" blocks ASAP, not tomorrow';

  -- 103.2 'indefinite' → tomorrow refused too
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform public.set_menu_item_sold_out(v_item, 'indefinite');
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => v_items, p_delivery_address_id => v_addr, p_requested_for => v_tomorrow,
              p_idempotency_key => 'sim103-inf-tomorrow');
    raise exception 'FAIL 103.2: "până revin" did not block an order for tomorrow';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' or sqlerrm not like '%epuizat%' then raise; end if;
  end;
  raise notice 'PASS 103.2: "indefinite" blocks tomorrow too';

  -- 103.3 'off' → orderable again ASAP
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform public.set_menu_item_sold_out(v_item, 'off');
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
            p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim103-off');
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 103.3: "off" makes it orderable again';
end $$;
