-- Cash-aware dispatch — dezbatere 2026-08-12 BUG (P4): an offer for a big cash
-- order used to go to a courier whose float would blow the cap at delivery,
-- triggering the auto-offline punishment. dispatch_order now skips them.
-- C1: big cash order to a near-cap courier -> NO offer.
-- C2: small cash order (fits under cap) -> offer goes out.
-- C3: card order ignores the float entirely -> offer even when near cap.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid; v_item uuid; v_addr uuid; v_qty int; v_price numeric;
  v_oid uuid; v_n int; v_cap numeric; v_headroom numeric;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  select mi.id, mi.price_mdl into v_item, v_price from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  select id into v_courier from public.couriers where user_id = v_courier_user;
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_courier, 'refund_reversal', -public.courier_cash_balance(v_courier), 'sim baseline zero (rolled back)'
  where public.courier_cash_balance(v_courier) > 0;
  update public.couriers set status = 'online', is_active = true, consecutive_ignored_offers = 0 where id = v_courier;
  update public.couriers set status = 'offline' where id <> v_courier;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier, 47.0245, 28.8322, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();

  -- park the courier just under the cap: headroom = one cheap item + 100
  v_cap := public.effective_cash_cap(v_courier);
  v_qty := greatest(1, ceil((select min_order_amount_mdl from public.restaurants where id=v_rest) / v_price))::int;
  -- park the courier so the SAME checkout-legal order busts the cap in C1
  -- (headroom 100 under the order size) and fits after an offload in C2
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  values (v_courier, 'collected', v_cap - (v_qty * v_price) + 100, 'sim near-cap float (rolled back)');

  -- ===== C1: BIG cash order (3x the headroom) -> no offer =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_n from public.dispatch_offers where order_id = v_oid;
  if v_n > 0 then
    raise exception 'FAIL C1: cash order offered although it lands the courier past the cap';
  end if;
  raise notice 'PASS C1: over-cap cash order withheld from the near-cap courier';

  -- ===== C2: after a big offload the SAME size order fits -> offered =====
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  values (v_courier, 'offload', -(v_qty * v_price + 300), 'sim offload (rolled back)');
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_n from public.dispatch_offers where order_id = v_oid and status='offered';
  if v_n = 0 then
    raise exception 'FAIL C2: small cash order (fits under cap) was not offered';
  end if;
  raise notice 'PASS C2: fitting cash order still dispatches';
  update public.dispatch_offers set status='cancelled' where order_id = v_oid;

  -- ===== C3: CARD order ignores the float =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'card_on_delivery',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty * 3)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_n from public.dispatch_offers where order_id = v_oid and status='offered';
  if v_n = 0 then
    raise exception 'FAIL C3: card order was withheld although the cash float is irrelevant';
  end if;
  raise notice 'PASS C3: card orders bypass the cash gate';
end $$;
