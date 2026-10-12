-- confirm_catering_quote refuses an amount the customer did not see (migration 20261012000311). Rolled back by runner.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_staff uuid; v_mid uuid; v_p numeric; v_o uuid; v_o2 uuid; v_err text; v_st text; v_items jsonb;
begin
  select user_id into v_staff from public.restaurant_staff where restaurant_id = c_rest limit 1;
  select mi.id, mi.price_mdl into v_mid, v_p from public.menu_items mi where mi.restaurant_id = c_rest and mi.is_available
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
    and (mi.sold_out_until is null or mi.sold_out_until <= now()) order by mi.price_mdl desc limit 1;
  if v_staff is null or v_mid is null then raise exception 'P0: no staff/item — sim proves nothing'; end if;
  update public.restaurants set accepting_orders = true where id = c_rest;
  v_items := jsonb_build_array(jsonb_build_object('menu_item_id', v_mid, 'quantity', ceil(3000 / v_p)::int + 1));

  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  v_o := public.place_order(c_rest, 'catering', 'cash', v_items, null, now() + interval '10 days', null,
    jsonb_build_object('event_date', (now() + interval '10 days')::date, 'event_time', '18:00', 'guest_count', 20,
      'event_address_text', 'sim 214', 'contact_person', 'X', 'contact_phone', '060000000'), 'K-214-A', null);
  v_o2 := public.place_order(c_rest, 'catering', 'cash', v_items, null, now() + interval '11 days', null,
    jsonb_build_object('event_date', (now() + interval '11 days')::date, 'event_time', '18:00', 'guest_count', 20,
      'event_address_text', 'sim 214 b', 'contact_person', 'X', 'contact_phone', '060000000'), 'K-214-B', null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform public.submit_catering_quote(v_o, 3500);
  perform public.submit_catering_quote(v_o2, 3500);
  perform public.submit_catering_quote(v_o, 9000); -- re-quote after the customer saw 3500

  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  -- Q1: shown 3500, now 9000 -> refused, nothing written
  begin
    perform public.confirm_catering_quote(v_o, 3500);
    raise exception 'Q1: confirm with a stale amount went through';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'oferta s-a schimbat%' then raise exception 'Q1: wrong refusal: %', v_err; end if;
  end;
  select status into v_st from public.orders where id = v_o;
  if v_st <> 'pending_restaurant' then raise exception 'Q2: refused confirm changed status to %', v_st; end if;
  -- Q3: the amount they now see (9000) confirms
  perform public.confirm_catering_quote(v_o, 9000);
  select status into v_st from public.orders where id = v_o;
  if v_st <> 'accepted' then raise exception 'Q3: confirm with the right amount left status %', v_st; end if;
  -- Q4: old one-argument call keeps working (default null)
  perform public.confirm_catering_quote(v_o2);
  select status into v_st from public.orders where id = v_o2;
  if v_st <> 'accepted' then raise exception 'Q4: legacy call left status %', v_st; end if;
end $$;
