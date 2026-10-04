-- 80: an unauthenticated caller cannot touch money RPCs, and a NULL auth.uid() is never "the owner"
-- (migration 20261004000900). Found by the cross-app E2E audit: anon could rewrite another
-- customer's tip/total (set_order_tip) and flip payment_status (start_online_payment).
-- Two independent defences are proven separately: the GRANT (anon role) and the BODY (a signed-in
-- role whose JWT carries no sub). Then an inverse sweep: anon executes ONLY the allow-listed
-- helpers / public reads — a new function that forgets its REVOKE fails here.
do $$
declare
  c_client constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_other constant uuid := 'b0000000-0000-0000-0000-000000000001';
  c_rest constant uuid := '11111111-1111-1111-1111-111111111111';
  v_item uuid; v_addr uuid; v_oid uuid; v_tip numeric; v_pay text; v_msg text; v_bad text;
begin
  delete from public.restaurant_hours where restaurant_id = c_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select c_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = c_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;
  select id into v_addr from public.addresses where customer_id = c_client limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', c_client, 'role', 'authenticated')::text, true);
  v_oid := public.place_order(c_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, 'sim80', null, gen_random_uuid()::text);

  -- 1. GRANT: anon is refused outright
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.set_order_tip(v_oid, 777);
    reset role;
    raise exception 'FAIL 80.1: anon executed set_order_tip';
  exception when insufficient_privilege then reset role;
  end;
  set local role anon;
  begin
    perform public.start_online_payment(v_oid);
    reset role;
    raise exception 'FAIL 80.2: anon executed start_online_payment';
  exception when insufficient_privilege then reset role;
  end;

  -- 2. BODY: a signed-in role with NO sub (auth.uid() is null) is not the owner
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  set local role authenticated;
  foreach v_msg in array array['select public.set_order_tip(''' || v_oid || ''', 777)', 'select public.start_online_payment(''' || v_oid || ''')'] loop
    begin
      execute v_msg;
      reset role;
      raise exception 'FAIL 80.3: NULL auth.uid() passed the ownership guard: %', v_msg;
    exception when others then
      reset role;
      if sqlerrm like 'FAIL%' then raise; end if;
      set local role authenticated;
    end;
  end loop;
  reset role;
  select tip_mdl, payment_status into v_tip, v_pay from public.orders where id = v_oid;
  if coalesce(v_tip, 0) <> 0 or v_pay <> 'unpaid' then raise exception 'FAIL 80.4: order changed (tip %, payment %)', v_tip, v_pay; end if;

  -- 3. another signed-in customer is refused, the owner is served
  perform set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_order_tip(v_oid, 777);
    reset role;
    raise exception 'FAIL 80.5: a different customer set the tip';
  exception when others then reset role; if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', c_client, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_order_tip(v_oid, 10);
  reset role;
  select tip_mdl into v_tip from public.orders where id = v_oid;
  if v_tip <> 10 then raise exception 'FAIL 80.6: the owner could not set the tip (%)', v_tip; end if;

  -- 4. inverse sweep over anon's EXECUTE (trigger functions cannot be called directly: skipped)
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into v_bad
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
    and p.prorettype <> 'trigger'::regtype
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    and p.proname <> all (array[
      -- public reads
      'current_pricing_config', 'popular_hours', 'public_courier_tariff_history', 'public_pricing_history', 'rating_breakdown',
      'get_prep_estimates', 'haversine_km', 'nearby_restaurants', 'restaurant_open_at', 'search_menu_items',
      -- helpers RLS policies evaluate for the anon role too (no data of their own)
      'has_role', 'has_any_role', 'has_restaurant_access', 'current_courier_id', 'courier_is_assigned_to_address',
      'customer_has_active_order_with_courier', 'customer_has_order_with_courier', 'customer_sees_courier_point',
      'restaurant_has_active_order_with_courier', 'restaurant_sees_courier_point']);
  if v_bad is not null then
    raise exception 'FAIL 80.7: anon can execute functions outside the allow-list (add `revoke execute ... from public, anon`, or allow-list it here if it is a public read): %', v_bad;
  end if;
  raise notice 'PASS 80: anon and NULL-uid callers cannot tip / start payment; owner can; anon EXECUTE = allow-list only';
end $$;
