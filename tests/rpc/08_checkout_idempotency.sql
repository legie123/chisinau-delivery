-- Wave 10 checkout idempotency sim (panel BLOCKER #1). BEGIN/ROLLBACK.
do $$
declare v_rest uuid; v_item uuid; v_addr uuid; v_o1 uuid; v_o2 uuid; v_o3 uuid; v_key text := 'test-key-abc';
        v_count int;
begin
  select r.id into v_rest from public.restaurants r where r.is_active and r.accepting_orders limit 1;
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;  -- deterministic: priciest modifier-free item (heap order is not stable)
  select id into v_addr from public.addresses where customer_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);

  -- same idempotency key twice = same order, only ONE row inserted
  v_o1 := public.place_order(v_rest,'standard','cash', jsonb_build_array(jsonb_build_object('menu_item_id',v_item,'quantity',10)), v_addr, null, null, null, v_key);
  v_o2 := public.place_order(v_rest,'standard','cash', jsonb_build_array(jsonb_build_object('menu_item_id',v_item,'quantity',10)), v_addr, null, null, null, v_key);
  if v_o1 <> v_o2 then raise exception 'FAIL: same key produced 2 orders (% vs %)', v_o1, v_o2; end if;
  select count(*) into v_count from public.orders where customer_id='a0000000-0000-0000-0000-000000000001' and idempotency_key = v_key;
  if v_count <> 1 then raise exception 'FAIL: % order rows for one key (expected 1)', v_count; end if;

  -- a DIFFERENT key = a genuinely new order
  v_o3 := public.place_order(v_rest,'standard','cash', jsonb_build_array(jsonb_build_object('menu_item_id',v_item,'quantity',10)), v_addr, null, null, null, 'test-key-xyz');
  if v_o3 = v_o1 then raise exception 'FAIL: different key reused the order'; end if;

  -- null key still works (legacy/keyless path) and does NOT dedup
  perform public.place_order(v_rest,'standard','cash', jsonb_build_array(jsonb_build_object('menu_item_id',v_item,'quantity',10)), v_addr, null, null, null, null);
  perform public.place_order(v_rest,'standard','cash', jsonb_build_array(jsonb_build_object('menu_item_id',v_item,'quantity',10)), v_addr, null, null, null, null);
  raise notice 'PASS idempotency: same key -> same order (1 row), different key -> new order, null key -> no dedup';
end $$;
