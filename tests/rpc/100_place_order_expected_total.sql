-- 100: the customer pays what was shown (migration 20261012000101). place_order takes the total the
-- checkout displayed (p_expected_total = subtotal + delivery fee, tip excluded: set_order_tip adds it
-- separately, capped). If the server's re-priced total differs — the delivery fee or a menu price
-- changed between display and tap — the call is refused and NO order is created. NULL = old behaviour
-- (callers that do not send it yet, e.g. web checkout until it passes the total too).
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_price numeric; v_qty int; v_fee numeric; v_addr uuid; v_oid uuid; v_shown numeric; v_total numeric;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  update public.restaurants set accepting_orders = true, is_active = true where id = v_rest;
  select mi.id, mi.price_mdl, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int, r.delivery_fee_mdl
    into v_item, v_price, v_qty, v_fee
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  v_shown := v_price * v_qty + v_fee;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);

  -- 100.1 the shown total matches: placed, charged exactly that
  v_oid := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
             p_items => jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)),
             p_delivery_address_id => v_addr, p_idempotency_key => 'sim100-ok', p_expected_total => v_shown);
  select total_mdl into v_total from public.orders where id = v_oid;
  if v_total <> v_shown then raise exception 'FAIL 100.1: charged % for a shown %', v_total, v_shown; end if;
  raise notice 'PASS 100.1: shown total accepted and charged as shown';

  -- 100.2 the delivery fee changed after the checkout read it: refused, no order
  update public.restaurants set delivery_fee_mdl = delivery_fee_mdl + 10 where id = v_rest;
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)),
              p_delivery_address_id => v_addr, p_idempotency_key => 'sim100-fee', p_expected_total => v_shown);
    raise exception 'FAIL 100.2: placed after the delivery fee changed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'prețul s-a schimbat%' then raise exception 'FAIL 100.2: wrong refusal: %', sqlerrm; end if;
  end;
  if exists (select 1 from public.orders where idempotency_key = 'sim100-fee') then
    raise exception 'FAIL 100.2: a refused order left a row';
  end if;
  update public.restaurants set delivery_fee_mdl = delivery_fee_mdl - 10 where id = v_rest;
  raise notice 'PASS 100.2: fee change after display refused, nothing written';

  -- 100.3 a menu price changed after display: refused
  update public.menu_items set price_mdl = price_mdl + 5 where id = v_item;
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)),
              p_delivery_address_id => v_addr, p_idempotency_key => 'sim100-price', p_expected_total => v_shown);
    raise exception 'FAIL 100.3: placed after the item price changed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'prețul s-a schimbat%' then raise exception 'FAIL 100.3: wrong refusal: %', sqlerrm; end if;
  end;
  raise notice 'PASS 100.3: price change after display refused';

  -- 100.4 no expected total (web, old builds): unchanged behaviour
  v_oid := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
             p_items => jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)),
             p_delivery_address_id => v_addr, p_idempotency_key => 'sim100-null');
  if v_oid is null then raise exception 'FAIL 100.4: no order without p_expected_total'; end if;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 100.4: callers without p_expected_total still place';
end $$;

-- 100.5 exactly one place_order signature (no ambiguous overload left behind)
do $$
begin
  if (select count(*) from pg_proc where proname = 'place_order' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'FAIL 100.5: % place_order signatures', (select count(*) from pg_proc where proname = 'place_order');
  end if;
  if has_function_privilege('anon', 'public.place_order(uuid,text,text,jsonb,uuid,timestamptz,text,jsonb,text,numeric)', 'execute') then
    raise exception 'FAIL 100.5: anon can execute place_order';
  end if;
  raise notice 'PASS 100.5: one signature, anon locked out';
end $$;
