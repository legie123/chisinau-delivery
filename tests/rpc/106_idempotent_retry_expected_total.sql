-- 106: a retry with the SAME idempotency key but a different shown total must not silently return the
-- old order (verifier finding, gate 2): the response of the first tap is lost, the customer changes
-- the quantity and taps again — before 20261012000104 place_order returned the old order (charged
-- 2378 MDL while the screen showed 818). Same key + same total = the old order (a real retry);
-- same key + different total = refused, naming the order that already exists. Nothing new written.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_price numeric; v_qty int; v_fee numeric; v_addr uuid; v_first uuid; v_again uuid; v_n int;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  update public.restaurants set accepting_orders = true, is_active = true where id = v_rest;
  select mi.id, mi.price_mdl, greatest(2, ceil(r.min_order_amount_mdl / mi.price_mdl))::int, r.delivery_fee_mdl
    into v_item, v_price, v_qty, v_fee
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and (mi.sold_out_until is null or mi.sold_out_until <= now())
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng)
  values (v_cust, 'sim106', '+37360000000', 47.0250, 28.8330) returning id into v_addr;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);

  v_first := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
               p_items => jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty + 1)),
               p_delivery_address_id => v_addr, p_idempotency_key => 'sim106', p_expected_total => v_price * (v_qty + 1) + v_fee);

  -- 106.1 a true retry (same cart, same total) returns the same order
  v_again := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
               p_items => jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty + 1)),
               p_delivery_address_id => v_addr, p_idempotency_key => 'sim106', p_expected_total => v_price * (v_qty + 1) + v_fee);
  if v_again is distinct from v_first then raise exception 'FAIL 106.1: a true retry did not return the same order'; end if;
  raise notice 'PASS 106.1: same key + same total = the same order';

  -- 106.2 same key, smaller cart, different shown total: refused, no second order
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)),
              p_delivery_address_id => v_addr, p_idempotency_key => 'sim106', p_expected_total => v_price * v_qty + v_fee);
    raise exception 'FAIL 106.2: a retry with a different shown total returned the old order silently';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'comanda a fost deja plasată%' then raise exception 'FAIL 106.2: wrong refusal: %', sqlerrm; end if;
  end;
  select count(*) into v_n from public.orders where customer_id = v_cust and idempotency_key = 'sim106';
  if v_n <> 1 then raise exception 'FAIL 106.2: % orders under the key', v_n; end if;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 106.2: same key + different total refused, still one order';
end $$;
