-- Wave A2: a CONFIRMED catering order must be able to go "ready" and dispatch,
-- exactly like a standard order. Before this, the restaurant UI offered no
-- mark-ready control for catering, so a confirmed catering order stranded at
-- 'accepted' forever. This proves the DB path the new "Marchează gata" button
-- calls (mark_ready_for_pickup) works for catering: place → quote → confirm →
-- mark ready → a dispatch_offer appears + status advances. Rolled back by runner.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';       -- Sakura (partner a...03 is staff)
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid; v_item uuid; v_addr uuid; v_oid uuid; v_offer uuid;
  v_status text; v_quote text;
begin
  -- Arrange: catering-capable restaurant, open hours, an available item, and
  -- exactly one online courier near the restaurant with free capacity.
  update public.restaurants set accepts_catering = true, catering_min_amount_mdl = 0 where id = v_rest;
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;  -- deterministic: priciest modifier-free item (heap order is not stable)
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  select id into v_courier from public.couriers where user_id = v_courier_user;
  -- neutralize residual live cash float (armata 2026-08-13: the cash-aware
  -- dispatch gate legitimately skips float-loaded couriers; sims need a clean
  -- baseline — refund_reversal lowers the ledger without touching recompute)
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_courier, 'refund_reversal', -public.courier_cash_balance(v_courier), 'sim baseline zero (rolled back)'
  where public.courier_cash_balance(v_courier) > 0;

  update public.orders set status = 'cancelled', courier_id = null
  where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  update public.couriers set status = 'offline' where id <> v_courier;
  update public.couriers set status = 'online', is_active = true where id = v_courier;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier, 47.0245, 28.8322, now())
  on conflict (courier_id) do update set lat = 47.0245, lng = 28.8322, updated_at = now();

  -- 1. customer places a catering order (quote-first)
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'catering', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 20)),
    v_addr, null, 'Nuntă — 50 invitați',
    jsonb_build_object(
      'event_date', (now() + interval '14 days')::date::text,
      'event_time', '18:00',
      'guest_count', 50,
      'event_address_text', 'Sala Palatului, Chișinău',
      'contact_person', 'Ion Testu',
      'contact_phone', '069000000'
    ), null);

  select status into v_status from public.orders where id = v_oid;
  if v_status <> 'pending_restaurant' then raise exception 'FAIL A2: fresh catering order at % (expected pending_restaurant)', v_status; end if;

  -- 2. partner quotes it
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.submit_catering_quote(v_oid, 8000);

  -- 3. customer confirms → order joins the standard pipeline at 'accepted'
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  perform public.confirm_catering_quote(v_oid);
  select status into v_status from public.orders where id = v_oid;
  select quote_status into v_quote from public.catering_details where order_id = v_oid;
  if v_status <> 'accepted' then raise exception 'FAIL A2: confirmed catering at % (expected accepted)', v_status; end if;
  if v_quote <> 'confirmed' then raise exception 'FAIL A2: quote_status % (expected confirmed)', v_quote; end if;

  -- 4. THE FIX: partner marks the confirmed catering order ready → dispatch fires
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.mark_ready_for_pickup(v_oid);

  select status into v_status from public.orders where id = v_oid;
  if v_status <> 'ready_for_pickup' then raise exception 'FAIL A2: after mark-ready status % (expected ready_for_pickup)', v_status; end if;

  select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offer is null then raise exception 'FAIL A2: catering mark-ready fired NO dispatch offer to the only online courier'; end if;

  raise notice 'PASS A2: confirmed catering → mark_ready_for_pickup → ready_for_pickup + dispatch_offer created';
end $$;
