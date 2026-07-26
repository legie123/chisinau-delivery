-- Wave (operability) — reorder replay. A delivered order containing a REQUIRED-
-- modifier dish must be re-orderable: the app replays the original selected_options
-- snapshot, mapping (group name, option name) back to the CURRENT menu_options id.
-- This proves that path end-to-end: place with an option → read the snapshot → map
-- it back to the option id → place AGAIN with the replayed id succeeds (the exact
-- reorder flow), instead of the old dead-end where reorder sent no options and
-- place_order raised 'alege o opțiune la ...'. Rolled back by runner.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';  -- Sakura
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_grp text; v_opt_name text; v_opt_id uuid; v_replayed uuid;
  v_addr uuid; v_oid1 uuid; v_oid2 uuid; v_snap jsonb; v_raised boolean;
begin
  update public.restaurants set min_order_amount_mdl = 0 where id = v_rest; -- isolate the modifier check
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- an item with a REQUIRED option group + one of its options
  select g.menu_item_id, g.name, o.name, o.id
    into v_item, v_grp, v_opt_name, v_opt_id
  from public.menu_option_groups g
  join public.menu_options o on o.group_id = g.id
  join public.menu_items mi on mi.id = g.menu_item_id
  where mi.restaurant_id = v_rest and g.min_select >= 1 and mi.is_available and not mi.is_catering_only
  order by g.name, o.sort_order limit 1;
  if v_item is null then raise exception 'FAIL setup: no required-modifier item at Sakura'; end if;

  -- 0. sanity: without the required option, place_order MUST reject (the dead-end cause)
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_raised := false;
  begin
    perform public.place_order(v_rest, 'standard', 'cash',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null, null);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: required-modifier item placed with NO option (guard missing)'; end if;

  -- 1. place WITH the option (the original order)
  v_oid1 := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1, 'option_ids', jsonb_build_array(v_opt_id))),
    v_addr, null, null, null, null);

  -- 2. read the snapshot the reorder page reads
  select selected_options into v_snap from public.order_items where order_id = v_oid1 and menu_item_id = v_item;
  if v_snap is null or jsonb_array_length(v_snap) = 0 then raise exception 'FAIL: snapshot did not record the chosen option'; end if;
  if not (v_snap @> jsonb_build_array(jsonb_build_object('group', v_grp, 'name', v_opt_name))) then
    raise exception 'FAIL: snapshot missing (%, %) — got %', v_grp, v_opt_name, v_snap;
  end if;

  -- 3. REPLAY: map (group name, option name) from the snapshot back to the current option id
  select o.id into v_replayed
  from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
  where g.menu_item_id = v_item and g.name = v_grp and o.name = v_opt_name;
  if v_replayed is null then raise exception 'FAIL: replay could not map snapshot back to an option id'; end if;

  -- 4. reorder = place AGAIN with the replayed option id → must succeed (no dead-end)
  v_oid2 := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1, 'option_ids', jsonb_build_array(v_replayed))),
    v_addr, null, null, null, null);
  if v_oid2 is null or v_oid2 = v_oid1 then raise exception 'FAIL: reorder did not place a new order'; end if;

  raise notice 'PASS reorder-replay: item %/% — no-option REJECTED, snapshot replayed to option %, reorder placed % ', v_grp, v_opt_name, v_replayed, v_oid2;
end $$;
