-- Quick "Epuizat" (migration 20261012000303_menu_sold_out). Sold out is NOT hidden:
-- menu_items.sold_out_until is separate from is_available, so the item stays
-- publicly readable (the customer sees it greyed out) while place_order can refuse
-- it (CLIENT's guard). set_menu_item_sold_out: 'today' = until the next Chișinău
-- midnight, 'indefinite' = until switched back, 'off' = available. Rolled back by runner.
do $$
declare
  c_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_item uuid := (select id from public.menu_items where restaurant_id = '11111111-1111-1111-1111-111111111111' and is_available order by name limit 1);
  c_foreign_item uuid := (select id from public.menu_items where restaurant_id = 'd0000000-0000-0000-0000-000000000003' limit 1);
  v_until timestamptz; v_want timestamptz; v_n int; v_avail boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', c_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- S1: 'today' → next local midnight, still is_available
  perform public.set_menu_item_sold_out(c_item, 'today');
  select sold_out_until, is_available into v_until, v_avail from public.menu_items where id = c_item;
  v_want := (date_trunc('day', now() at time zone 'Europe/Chisinau') + interval '1 day') at time zone 'Europe/Chisinau';
  if v_until is distinct from v_want then raise exception 'S1: sold_out_until=% want %', v_until, v_want; end if;
  if not v_avail then raise exception 'S1: sold out flipped is_available'; end if;

  -- S2: a customer and anon still read the item (sold out ≠ hidden)
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.menu_items where id = c_item and sold_out_until > now();
  if v_n <> 1 then raise exception 'S2: customer cannot see the sold-out item'; end if;
  set local role anon;
  select count(*) into v_n from public.menu_items where id = c_item;
  if v_n <> 1 then raise exception 'S2b: anon cannot see the sold-out item'; end if;

  -- S3: 'indefinite' → infinity; 'off' → null
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', c_partner, 'role', 'authenticated')::text, true);
  perform public.set_menu_item_sold_out(c_item, 'indefinite');
  select sold_out_until into v_until from public.menu_items where id = c_item;
  if v_until <> 'infinity'::timestamptz then raise exception 'S3: indefinite=%', v_until; end if;
  perform public.set_menu_item_sold_out(c_item, 'off');
  select sold_out_until into v_until from public.menu_items where id = c_item;
  if v_until is not null then raise exception 'S3b: off left %', v_until; end if;

  -- S4: bad mode, foreign item, customer → refused
  begin perform public.set_menu_item_sold_out(c_item, 'tomorrow'); raise exception 'S4: bad mode accepted';
  exception when others then if sqlerrm like 'S4:%' then raise; end if; end;
  begin perform public.set_menu_item_sold_out(c_foreign_item, 'today'); raise exception 'S4b: foreign item accepted';
  exception when others then if sqlerrm like 'S4b:%' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin perform public.set_menu_item_sold_out(c_item, 'today'); raise exception 'S4c: customer accepted';
  exception when others then if sqlerrm like 'S4c:%' then raise; end if; end;

  -- S5: anon cannot execute
  reset role;
  if has_function_privilege('anon', 'public.set_menu_item_sold_out(uuid,text)', 'execute') then
    raise exception 'S5: anon can execute'; end if;

  raise notice 'menu sold out S1-S5 OK';
end $$;
