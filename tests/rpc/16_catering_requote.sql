-- Operability fix — a partner can CORRECT a mis-typed catering quote until the
-- customer confirms it (previously locked after the first submit → guaranteed loss
-- if they typed 1 instead of 1000). Re-quote allowed while quote_status in
-- (requested, quoted) AND order still pending_restaurant; blocked once confirmed.
-- Rolled back by runner.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_item uuid; v_addr uuid; v_oid uuid; v_total numeric; v_qs text; v_raised boolean;
begin
  update public.restaurants set accepts_catering = true, catering_min_amount_mdl = 0 where id = v_rest;
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;  -- deterministic: priciest modifier-free item (heap order is not stable)
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- customer places a catering request
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'catering', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 30)), v_addr, null, null,
    jsonb_build_object('event_date', (now() + interval '10 days')::date::text, 'event_time', '18:00',
      'guest_count', 40, 'event_address_text', 'Sala X', 'contact_person', 'Y', 'contact_phone', '069'), null);

  -- partner FAT-FINGERS the quote (100 MDL, meant 1000)
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.submit_catering_quote(v_oid, 100);
  select quote_status, quoted_total_mdl into v_qs, v_total from public.catering_details where order_id = v_oid;
  if v_qs <> 'quoted' or v_total <> 100 then raise exception 'FAIL: first quote not recorded (% / %)', v_qs, v_total; end if;

  -- THE FIX: partner CORRECTS it to 1000 MDL (re-quote from 'quoted')
  perform public.submit_catering_quote(v_oid, 1000);
  select quote_status, quoted_total_mdl into v_qs, v_total from public.catering_details where order_id = v_oid;
  if v_qs <> 'quoted' or v_total <> 1000 then raise exception 'FAIL: re-quote did not correct the amount (% / %)', v_qs, v_total; end if;

  -- customer confirms the CORRECTED amount
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  perform public.confirm_catering_quote(v_oid);

  -- after confirmation, re-quote MUST be blocked (order no longer pending_restaurant)
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  v_raised := false;
  begin
    perform public.submit_catering_quote(v_oid, 500);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: re-quote allowed AFTER the customer confirmed'; end if;

  raise notice 'PASS catering re-quote: 1 → corrected to 1000 before confirm; blocked after confirm';
end $$;

-- ===== N: quoting (and re-quoting) notifies the customer (audit 2026-08-11) =====
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_item uuid; v_addr uuid; v_oid uuid; v_before int; v_after int;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'catering', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 20)),
    v_addr, null, 'eveniment test',
    jsonb_build_object(
      'event_date', (now() + interval '14 days')::date::text,
      'event_time', '18:00',
      'guest_count', 30,
      'event_address_text', 'Sala Test, Chișinău',
      'contact_person', 'Ion Testu',
      'contact_phone', '069000000'
    ), null);

  select count(*) into v_before from public.notification_outbox where user_id = v_cust and tag = 'catering-quote-' || v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.submit_catering_quote(v_oid, 9000);
  perform public.submit_catering_quote(v_oid, 8500);  -- correction while still 'quoted'
  perform set_config('request.jwt.claims', null, true);

  select count(*) into v_after from public.notification_outbox where user_id = v_cust and tag = 'catering-quote-' || v_oid;
  if v_after - v_before <> 2 then
    raise exception 'FAIL N: expected 2 quote notifications (first + correction), got %', v_after - v_before;
  end if;
  raise notice 'PASS N: quote + re-quote each queued a customer notification';
end $$;
