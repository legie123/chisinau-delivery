-- 107 (CROSS, written by CLIENT, fixes RESTAURANT behaviour): the customer's tracking countdown reads
-- orders.estimated_ready_at (row-filtered realtime, mobile/client mergeOrderRow). The kitchen's
-- "busy" mode (set_restaurant_busy) must push the ETA of an order accepted while busy, and
-- extend_prep_time must push it after acceptance — and the customer must SEE the new value under
-- RLS. Red here = RESTAURANT fixes its code; this test is not edited by the emitter.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_staff uuid := 'a0000000-0000-0000-0000-000000000003';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_qty int; v_addr uuid; v_items jsonb; v_a uuid; v_b uuid;
  v_eta_a timestamptz; v_eta_b timestamptz; v_eta_ext timestamptz; v_seen timestamptz;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  update public.restaurants set accepting_orders = true, is_active = true, busy_until = null, busy_extra_minutes = 0 where id = v_rest;
  select mi.id, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int into v_item, v_qty
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and (mi.sold_out_until is null or mi.sold_out_until <= now())
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng)
  values (v_cust, 'sim107', '+37360000000', 47.0250, 28.8330) returning id into v_addr;
  v_items := jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty));

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  v_a := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
           p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim107-a');
  v_b := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
           p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim107-b');

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform public.accept_order(v_a);                       -- normal kitchen
  perform public.set_restaurant_busy(v_rest, 30);         -- kitchen goes busy (+30 min)
  perform public.accept_order(v_b);                       -- accepted while busy
  select estimated_ready_at into v_eta_a from public.orders where id = v_a;
  select estimated_ready_at into v_eta_b from public.orders where id = v_b;

  -- 107.1 busy mode pushes the ETA of an order accepted while busy
  if v_eta_b < v_eta_a + interval '25 minutes' then
    raise exception 'FAIL 107.1: accepted while busy (+30) but ETA only % later', v_eta_b - v_eta_a;
  end if;
  raise notice 'PASS 107.1: busy mode pushes the ETA (% later)', date_trunc('minute', v_eta_b - v_eta_a);

  -- 107.2 extend_prep_time pushes it after acceptance, and the customer sees it under RLS
  perform public.extend_prep_time(v_a, 10);
  select estimated_ready_at into v_eta_ext from public.orders where id = v_a;
  if v_eta_ext < v_eta_a + interval '9 minutes' then
    raise exception 'FAIL 107.2: extend 10 moved the ETA by only %', v_eta_ext - v_eta_a;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select estimated_ready_at into v_seen from public.orders where id = v_a;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_seen is distinct from v_eta_ext then
    raise exception 'FAIL 107.2: the customer reads % instead of the extended %', v_seen, v_eta_ext;
  end if;
  raise notice 'PASS 107.2: extend_prep_time +10 visible to the customer';
end $$;
