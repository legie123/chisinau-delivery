-- 101: place_order refuses a dish the kitchen marked "Epuizat" (menu_items.sold_out_until, RESTAURANT
-- 20261012000303), migration 20261012000102. Sold out = sold_out_until > the moment the food is for:
-- now() for ASAP, p_requested_for for a scheduled order (sold out "today" does not block tomorrow).
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_qty int; v_addr uuid; v_oid uuid;
  v_items jsonb;
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
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  v_items := jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty));
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);

  -- 101.1 sold out until tomorrow: an ASAP order is refused with the dish name, nothing written
  update public.menu_items set sold_out_until = now() + interval '20 hours' where id = v_item;
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim101-asap');
    raise exception 'FAIL 101.1: a sold-out dish was ordered';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%epuizat%' then raise exception 'FAIL 101.1: wrong refusal: %', sqlerrm; end if;
  end;
  if exists (select 1 from public.orders where idempotency_key = 'sim101-asap') then
    raise exception 'FAIL 101.1: refused order left a row';
  end if;
  raise notice 'PASS 101.1: sold-out dish refused for ASAP';

  -- 101.2 indefinite ("până revin") is refused too
  update public.menu_items set sold_out_until = 'infinity' where id = v_item;
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim101-inf');
    raise exception 'FAIL 101.2: an indefinitely sold-out dish was ordered';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS 101.2: indefinitely sold-out dish refused';

  -- 101.3 a scheduled order for AFTER the sold-out window is accepted
  update public.menu_items set sold_out_until = now() + interval '2 hours' where id = v_item;
  v_oid := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
             p_items => v_items, p_delivery_address_id => v_addr, p_requested_for => now() + interval '1 day',
             p_idempotency_key => 'sim101-later');
  if v_oid is null then raise exception 'FAIL 101.3: scheduled order after the window refused'; end if;
  raise notice 'PASS 101.3: order scheduled after the sold-out window accepted';

  -- 101.4 a lapsed sold_out_until (past) does not block
  update public.menu_items set sold_out_until = now() - interval '1 minute' where id = v_item;
  v_oid := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
             p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim101-lapsed');
  if v_oid is null then raise exception 'FAIL 101.4: lapsed sold-out still blocks'; end if;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 101.4: lapsed sold-out does not block';
end $$;
