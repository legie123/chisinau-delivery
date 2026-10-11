-- 102: C1 — a standard order needs a pinned address inside the restaurant's delivery radius
-- (migration 20261012000103). No pin = refused (the courier would be paid on an assumed 6 km and have
-- no drop-off point); a pin farther than restaurants.delivery_radius_km = refused; inside = placed.
-- restaurants_delivering_to(lat, lng) applies the same rule for the Home list.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';   -- Sakura Sushi, 47.0245 / 28.8322
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_qty int; v_near uuid; v_far uuid; v_nopin uuid; v_oid uuid; v_items jsonb;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  update public.restaurants set accepting_orders = true, is_active = true, delivery_radius_km = 5 where id = v_rest;
  select mi.id, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int into v_item, v_qty
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and (mi.sold_out_until is null or mi.sold_out_until <= now())
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  v_items := jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty));
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng) values
    (v_cust, 'sim102 aproape', '+37360000000', 47.0300, 28.8400) returning id into v_near;   -- ~0.9 km
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng) values
    (v_cust, 'sim102 departe', '+37360000000', 47.1200, 28.8400) returning id into v_far;    -- ~10.6 km
  insert into public.addresses (customer_id, street_address, contact_phone) values
    (v_cust, 'sim102 fara pin', '+37360000000') returning id into v_nopin;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);

  -- 102.1 no pin: refused, nothing written
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => v_items, p_delivery_address_id => v_nopin, p_idempotency_key => 'sim102-nopin');
    raise exception 'FAIL 102.1: placed on an address without a pin';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'fixează pinul%' then raise exception 'FAIL 102.1: wrong refusal: %', sqlerrm; end if;
  end;
  if exists (select 1 from public.orders where idempotency_key = 'sim102-nopin') then raise exception 'FAIL 102.1: row left'; end if;
  raise notice 'PASS 102.1: pinless address refused';

  -- 102.2 pin outside the 5 km radius: refused
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => v_items, p_delivery_address_id => v_far, p_idempotency_key => 'sim102-far');
    raise exception 'FAIL 102.2: placed outside the delivery radius';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'adresa este în afara zonei%' then raise exception 'FAIL 102.2: wrong refusal: %', sqlerrm; end if;
  end;
  raise notice 'PASS 102.2: pin outside the radius refused';

  -- 102.3 pin inside: placed
  v_oid := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
             p_items => v_items, p_delivery_address_id => v_near, p_idempotency_key => 'sim102-near');
  if v_oid is null then raise exception 'FAIL 102.3: pinned address inside the radius refused'; end if;
  raise notice 'PASS 102.3: pinned address inside the radius placed';

  -- 102.4 the Home rule agrees: Sakura delivers to the near pin, not to the far one
  if not exists (select 1 from public.restaurants_delivering_to(47.0300, 28.8400) r where r = v_rest)
     or exists (select 1 from public.restaurants_delivering_to(47.1200, 28.8400) r where r = v_rest) then
    raise exception 'FAIL 102.4: restaurants_delivering_to disagrees with place_order';
  end if;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 102.4: restaurants_delivering_to applies the same radius';
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.restaurants_delivering_to(double precision,double precision)', 'execute') then
    raise exception 'FAIL 102.5: anon can execute restaurants_delivering_to';
  end if;
  raise notice 'PASS 102.5: anon locked out';
end $$;
