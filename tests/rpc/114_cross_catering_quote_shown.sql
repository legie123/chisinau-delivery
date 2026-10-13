-- 114 (cross, CLIENT consumer of RESTAURANT's 20261012000311): the customer confirms the catering amount
-- they were SHOWN. Repro docs/handoff/repro/catering-quote-confirm.sql used to print
-- "shown_quote=3500 confirmed_total=9000 no_error" (gate 2 verifier). Now: shown 3500, re-quoted 9000,
-- confirm with 3500 -> refused naming the new amount, nothing written; confirm with 9000 -> ok.
-- The apps (mobile OrderTrackingScreen, web CateringTracking) pass quotedTotalMdl as p_expected_total.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_staff uuid; v_mid uuid; v_p numeric; v_q int; v_o uuid; v_shown numeric;
begin
  select user_id into v_staff from public.restaurant_staff where restaurant_id = c_rest limit 1;
  update public.restaurants set accepting_orders = true, is_active = true, accepts_catering = true where id = c_rest;
  select mi.id, mi.price_mdl into v_mid, v_p from public.menu_items mi where mi.restaurant_id = c_rest and mi.is_available
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
    and (mi.sold_out_until is null or mi.sold_out_until <= now()) order by mi.price_mdl desc limit 1;
  if v_staff is null or v_mid is null then raise exception 'P0 114: no staff/item — sim proves nothing'; end if;
  v_q := ceil(3000 / v_p)::int + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  v_o := public.place_order(c_rest, 'catering', 'cash', jsonb_build_array(jsonb_build_object('menu_item_id', v_mid, 'quantity', v_q)), null,
           now() + interval '10 days', null,
           jsonb_build_object('event_date', (now() + interval '10 days')::date, 'event_time', '18:00', 'guest_count', 20,
                              'event_address_text', 'sim 114', 'contact_person', 'X', 'contact_phone', '060000000'),
           'K-SIM114');
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform public.submit_catering_quote(v_o, 3500);
  -- the customer opens the screen: 3500 shown
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  select quoted_total_mdl into v_shown from public.catering_details where order_id = v_o;
  if v_shown <> 3500 then raise exception 'P0 114: shown quote is %', v_shown; end if;
  -- the partner re-quotes while the screen is open
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform public.submit_catering_quote(v_o, 9000);
  -- 114.1 confirm with the SHOWN amount: refused, nothing written
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.confirm_catering_quote(v_o, v_shown);
    raise exception 'FAIL 114.1: confirmed 9000 after being shown 3500';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%oferta s-a schimbat%9000%' then raise exception 'FAIL 114.1: wrong refusal: %', sqlerrm; end if;
  end;
  if (select quote_status from public.catering_details where order_id = v_o) <> 'quoted'
     or (select total_mdl from public.orders where id = v_o) = 9000 then
    raise exception 'FAIL 114.1: the refused confirmation wrote something';
  end if;
  raise notice 'PASS 114.1: shown 3500, re-quoted 9000, confirm(3500) refused naming 9000, nothing written';
  -- 114.2 the customer sees the new amount and confirms it
  perform public.confirm_catering_quote(v_o, 9000);
  if (select quote_status from public.catering_details where order_id = v_o) <> 'confirmed'
     or (select total_mdl from public.orders where id = v_o) <> 9000 then
    raise exception 'FAIL 114.2: confirm(9000) did not confirm';
  end if;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 114.2: confirm with the current amount works';
end $$;
