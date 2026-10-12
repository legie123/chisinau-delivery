-- 111: an idempotent retry must be the SAME request (red-team round 2 on 1bb1f4b, migration
-- 20261012000108). place_order compared only the total on a key hit: another address, payment method,
-- dish at the same price, schedule — or a catering request with other guests/venue — silently got the
-- OLD order back (and the web then opened an online payment on a cash order). Now the canonical
-- request fingerprint is stored on the order; same key + same request = the old order, same key +
-- different request = refused naming the order. Orders placed before the fingerprint behave as before.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_item2 uuid; v_price numeric; v_qty int; v_fee numeric; v_home uuid; v_work uuid; v_o uuid; v_again uuid;
  v_items jsonb; v_total numeric; x record;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  update public.restaurants set accepting_orders = true, is_active = true where id = v_rest;
  select mi.id, mi.price_mdl, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int, r.delivery_fee_mdl into v_item, v_price, v_qty, v_fee
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and (mi.sold_out_until is null or mi.sold_out_until <= now())
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  -- a second dish at the SAME price (cloned for the test, rolled back)
  insert into public.menu_items (restaurant_id, name, price_mdl, is_available)
  values (v_rest, 'Sim 111 geamăn', v_price, true) returning id into v_item2;
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng) values (v_cust, 'sim111 acasă', '+37360000000', 47.0250, 28.8330) returning id into v_home;
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng) values (v_cust, 'sim111 birou', '+37360000000', 47.0300, 28.8400) returning id into v_work;
  v_items := jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty));
  v_total := v_price * v_qty + v_fee;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);

  v_o := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
           p_items => v_items, p_delivery_address_id => v_home, p_idempotency_key => 'sim111', p_expected_total => v_total);

  -- 111.1 a real retry (identical request) returns the same order
  v_again := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
               p_items => v_items, p_delivery_address_id => v_home, p_idempotency_key => 'sim111', p_expected_total => v_total);
  if v_again is distinct from v_o then raise exception 'FAIL 111.1: identical retry returned another order'; end if;
  raise notice 'PASS 111.1: identical retry = same order';

  -- 111.2 same key + same total but a different request: refused every time, still one order
  for x in select * from (values
      ('other address', jsonb_build_object('a', v_work)),
      ('other payment', jsonb_build_object('pm', 'card_on_delivery')),
      ('other dish, same price', jsonb_build_object('i', jsonb_build_array(jsonb_build_object('menu_item_id', v_item2, 'quantity', v_qty)))),
      ('scheduled now', jsonb_build_object('rf', now() + interval '1 day'))) t(what, d)
  loop
    begin
      perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard',
                p_payment_method => coalesce(x.d->>'pm', 'cash'),
                p_items => coalesce(x.d->'i', v_items),
                p_delivery_address_id => coalesce((x.d->>'a')::uuid, v_home),
                p_requested_for => (x.d->>'rf')::timestamptz,
                p_idempotency_key => 'sim111', p_expected_total => v_total);
      raise exception 'FAIL 111.2: % under the same key returned the old order', x.what;
    exception when raise_exception then
      if sqlerrm like 'FAIL%' then raise; end if;
      if sqlerrm not like 'comanda a fost deja plasată%' then raise exception 'FAIL 111.2: % wrong refusal: %', x.what, sqlerrm; end if;
    end;
  end loop;
  if (select count(*) from public.orders where idempotency_key = 'sim111') <> 1 then raise exception 'FAIL 111.2: more than one order under the key'; end if;
  raise notice 'PASS 111.2: same key + other address / payment / dish / schedule refused';

  -- 111.3 an order placed before the fingerprint existed keeps the old behaviour
  update public.orders set request_fingerprint = null where id = v_o;
  v_again := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
               p_items => v_items, p_delivery_address_id => v_work, p_idempotency_key => 'sim111', p_expected_total => v_total);
  if v_again is distinct from v_o then raise exception 'FAIL 111.3: legacy order (no fingerprint) not returned'; end if;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 111.3: orders without a fingerprint behave as before';
end $$;
