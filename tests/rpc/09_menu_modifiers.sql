-- Menu modifiers place_order validation + price recompute + snapshot. BEGIN/ROLLBACK.
do $$
declare
  v_rest uuid; v_item uuid; v_addr uuid; v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_soia uuid; v_teriyaki uuid; v_wasabi uuid; v_tempura uuid; v_foreign uuid;
  v_oid uuid; v_unit numeric; v_snap jsonb; v_raised boolean;
begin
  select id into v_rest from public.restaurants where slug = 'sakura-sushi';
  select mi.id into v_item from public.menu_items mi where mi.restaurant_id = v_rest and mi.name = 'California Roll';
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  update public.restaurants set accepting_orders = true, is_active = true where id = v_rest;

  select o.id into v_soia from public.menu_options o join public.menu_option_groups g on g.id=o.group_id where g.menu_item_id=v_item and o.name='Soia clasică';
  select o.id into v_teriyaki from public.menu_options o join public.menu_option_groups g on g.id=o.group_id where g.menu_item_id=v_item and o.name='Teriyaki';
  select o.id into v_wasabi from public.menu_options o join public.menu_option_groups g on g.id=o.group_id where g.menu_item_id=v_item and o.name='Wasabi extra';
  select o.id into v_tempura from public.menu_options o join public.menu_option_groups g on g.id=o.group_id where g.menu_item_id=v_item and o.name='Tempura crunch';
  -- an option from a DIFFERENT item (Supă Miso's "Mare")
  select o.id into v_foreign from public.menu_options o join public.menu_option_groups g on g.id=o.group_id
   join public.menu_items mi on mi.id=g.menu_item_id where mi.name='Supă Miso';

  perform set_config('request.jwt.claims', json_build_object('sub',v_cust,'role','authenticated')::text, true);

  -- 1) required group not satisfied → reject
  v_raised := false;
  begin
    perform public.place_order(v_rest,'standard','cash',
      jsonb_build_array(jsonb_build_object('menu_item_id',v_item,'quantity',1,'option_ids','[]'::jsonb)), v_addr,null,null,null,null);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: order placed without the required Sos option'; end if;

  -- 2) foreign option (belongs to another item) → reject
  v_raised := false;
  begin
    perform public.place_order(v_rest,'standard','cash',
      jsonb_build_array(jsonb_build_object('menu_item_id',v_item,'quantity',1,'option_ids',jsonb_build_array(v_foreign::text))), v_addr,null,null,null,null);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: foreign option accepted'; end if;

  -- 3) too many in a max_select=1 group (Soia + Teriyaki both in Sos) → reject
  v_raised := false;
  begin
    perform public.place_order(v_rest,'standard','cash',
      jsonb_build_array(jsonb_build_object('menu_item_id',v_item,'quantity',1,'option_ids',jsonb_build_array(v_soia::text, v_teriyaki::text))), v_addr,null,null,null,null);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: two options in a pick-one group accepted'; end if;

  -- 4) valid: Teriyaki (+10) + Wasabi (+5) + Tempura (+15) on a 180 roll → unit 210, snapshot has 3
  v_oid := public.place_order(v_rest,'standard','cash',
    jsonb_build_array(jsonb_build_object('menu_item_id',v_item,'quantity',2,'option_ids',jsonb_build_array(v_teriyaki::text, v_wasabi::text, v_tempura::text))), v_addr,null,null,null,null);
  select unit_price_mdl, selected_options into v_unit, v_snap from public.order_items where order_id = v_oid;
  if v_unit <> 210 then raise exception 'FAIL: unit recompute wrong -> % (expected 210 = 180+10+5+15)', v_unit; end if;
  if jsonb_array_length(v_snap) <> 3 then raise exception 'FAIL: snapshot has % options (expected 3)', jsonb_array_length(v_snap); end if;
  if (select total_mdl from public.orders where id=v_oid) <> 420 + (select delivery_fee_mdl from public.orders where id=v_oid) then
    raise exception 'FAIL: line total wrong (expected unit 210 x2 = 420 + fee)';
  end if;

  -- 5) client cannot forge a price: option deltas come from the DB snapshot, not any client field
  if exists (select 1 from jsonb_array_elements(v_snap) e where (e->>'price_delta_mdl')::numeric not in (0,5,10,15)) then
    raise exception 'FAIL: snapshot carries a non-DB price';
  end if;

  raise notice 'PASS modifiers: required enforced, foreign+overselect rejected, valid recompute unit=210 x2, snapshot(3) from DB prices';
end $$;
