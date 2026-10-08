-- Scheduled-order window (migration 20261008000200_scheduled_window): place_order
-- rejects p_requested_for in the past (2 min clock-skew grace) and beyond the horizon
-- the apps offer — standard 7 days (mobile WhenPicker days=7, web datetime max),
-- catering 60 days (mobile CateringScreen days=60, web date max). Before the fix a
-- past or year-ahead requested_for was stored as-is: a past one is "inside the
-- dispatch window" forever, a far one parks a pending order for months.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_qty int; v_cat_item uuid; v_addr uuid; v_oid uuid; v_err text;
  v_cat jsonb;
begin
  update public.restaurants set accepts_catering = true, catering_min_amount_mdl = 0 where id = v_rest;
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  select mi.id, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int into v_item, v_qty
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  select mi.id into v_cat_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);

  -- ===== W1: standard, 10 minutes in the past → refused (Romanian) =====
  v_err := null;
  begin
    perform public.place_order(v_rest, 'standard', 'card_on_delivery',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr,
      now() - interval '10 minutes', 'sim85-past', null, null);
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL 85.W1: requested_for 10 min in the past was accepted'; end if;
  if v_err not like '%în trecut%' then raise exception 'FAIL 85.W1: unexpected refusal: %', v_err; end if;
  raise notice 'PASS 85.W1: past requested_for refused (%)', v_err;

  -- ===== W2: 1 minute in the past = clock skew, accepted =====
  v_oid := public.place_order(v_rest, 'standard', 'card_on_delivery',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr,
    now() - interval '1 minute', 'sim85-skew', null, null);
  if v_oid is null then raise exception 'FAIL 85.W2: skew-grace order not placed'; end if;
  raise notice 'PASS 85.W2: 1 min skew tolerated';

  -- ===== W3: standard 8 days ahead → refused; 6 days → accepted =====
  v_err := null;
  begin
    perform public.place_order(v_rest, 'standard', 'card_on_delivery',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr,
      now() + interval '8 days', 'sim85-far', null, null);
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL 85.W3: standard order 8 days ahead was accepted (horizon 7)'; end if;
  if v_err not like '%7 zile%' then raise exception 'FAIL 85.W3: unexpected refusal: %', v_err; end if;
  v_oid := public.place_order(v_rest, 'standard', 'card_on_delivery',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr,
    now() + interval '6 days', 'sim85-6d', null, null);
  raise notice 'PASS 85.W3: standard horizon 7 days (%)', v_err;

  -- ===== W4: catering — 59 days accepted, 61 days and past refused =====
  v_cat := jsonb_build_object('event_date', (now() + interval '59 days')::date::text, 'event_time', '18:00',
    'guest_count', 30, 'event_address_text', 'Sala Test, Chișinău', 'contact_person', 'Ion Test', 'contact_phone', '069000000');
  v_oid := public.place_order(v_rest, 'catering', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_cat_item, 'quantity', 20)), v_addr,
    now() + interval '59 days', 'sim85-cat59', v_cat, null);
  v_err := null;
  begin
    perform public.place_order(v_rest, 'catering', 'cash',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_cat_item, 'quantity', 20)), v_addr,
      now() + interval '61 days', 'sim85-cat61', v_cat, null);
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL 85.W4: catering 61 days ahead was accepted (horizon 60)'; end if;
  v_err := null;
  begin
    perform public.place_order(v_rest, 'catering', 'cash',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_cat_item, 'quantity', 20)), v_addr,
      now() - interval '1 day', 'sim85-catpast', v_cat, null);
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL 85.W4: catering in the past was accepted'; end if;
  raise notice 'PASS 85.W4: catering horizon 60 days, past refused';

  -- ===== W5: ASAP (null requested_for) is untouched =====
  v_oid := public.place_order(v_rest, 'standard', 'card_on_delivery',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr,
    null, 'sim85-asap', null, null);
  raise notice 'PASS 85.W5: ASAP order unaffected';
end $$;
