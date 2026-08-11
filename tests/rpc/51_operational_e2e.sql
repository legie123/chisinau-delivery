-- OPERATIONAL end-to-end: one order through the WHOLE courier operation via the
-- real RPCs as each real role, asserting the full connective chain in a single
-- flow — place -> accept (ETA) -> mark_ready (dispatch engine offers) ->
-- accept_dispatch_offer (atomic claim) -> picked_up -> en_route -> delivered
-- (cash collected -> float accrued) -> admin_generate_payouts (courier +
-- restaurant settled) -> full 7-event audit trail. Existing 05 stops at ratings
-- and no single sim asserts cash-accrual AND payout settlement in the same live
-- chain — this is the operational regression that proves the machine runs.
-- Runner wraps in BEGIN/ROLLBACK (postgres superuser; auth via jwt claims).

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';   -- Sakura (partner a..03)
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002'; -- same courier as sim 05 (seed location near Sakura → plausible; arrange frees its capacity)
  v_courier uuid; v_item uuid; v_addr uuid; v_oid uuid; v_offer uuid;
  v_status text; v_pay text; v_eta boolean; v_events int; v_bal0 numeric; v_bal1 numeric; v_lines int;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;

  -- Arrange (rolled back): open hours, an item, chosen courier ONLY candidate.
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;  -- deterministic: priciest modifier-free item (heap order is not stable)
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  update public.orders set status='cancelled', courier_id=null where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  update public.couriers set status='offline' where id <> v_courier;
  update public.couriers set status='online', is_active=true where id = v_courier;
  insert into public.courier_locations (courier_id, lat, lng, updated_at) values (v_courier, 47.0245, 28.8322, now())
    on conflict (courier_id) do update set lat=excluded.lat, lng=excluded.lng, updated_at=now();

  -- 1. customer places
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 2, 'option_ids', '[]'::jsonb)),
    v_addr, null, 'OPS-E2E', null, gen_random_uuid()::text);
  select status into v_status from public.orders where id = v_oid;
  if v_status <> 'pending_restaurant' then raise exception 'FAIL place: %', v_status; end if;

  -- 2. restaurant accepts (ETA stamped)
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  select status, estimated_ready_at is not null into v_status, v_eta from public.orders where id = v_oid;
  if v_status <> 'accepted' or not v_eta then raise exception 'FAIL accept: status=% eta=%', v_status, v_eta; end if;

  -- 3. restaurant ready -> dispatch engine offers
  perform public.mark_ready_for_pickup(v_oid);
  select id, courier_id into v_offer, v_courier from public.dispatch_offers where order_id = v_oid and status='offered' order by offered_at desc limit 1;
  if v_offer is null then raise exception 'FAIL dispatch: no offer produced'; end if;

  -- 4. courier claims
  perform set_config('request.jwt.claims', json_build_object('sub', (select user_id from public.couriers where id=v_courier), 'role','authenticated')::text, true);
  perform public.accept_dispatch_offer(v_offer);
  select status into v_status from public.orders where id = v_oid;
  if v_status <> 'courier_assigned' then raise exception 'FAIL claim: %', v_status; end if;

  -- 5. deliver (cash collected -> float accrued)
  select public.courier_cash_balance(v_courier) into v_bal0;
  perform public.advance_delivery_status(v_oid, 'picked_up', false);
  perform public.advance_delivery_status(v_oid, 'en_route', false);
  perform public.advance_delivery_status(v_oid, 'delivered', true);
  select status, payment_status into v_status, v_pay from public.orders where id = v_oid;
  select public.courier_cash_balance(v_courier) into v_bal1;
  select count(*) into v_events from public.delivery_status_events where order_id = v_oid;
  if v_status <> 'delivered' then raise exception 'FAIL deliver: %', v_status; end if;
  if v_pay <> 'paid' then raise exception 'FAIL payment: %', v_pay; end if;
  if (v_bal1 - v_bal0) <= 0 then raise exception 'FAIL cash float not accrued (delta %)', (v_bal1 - v_bal0); end if;
  if v_events < 7 then raise exception 'FAIL audit trail: only % events', v_events; end if;

  -- 6. payouts settle courier + restaurant
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  perform public.admin_generate_payouts(date_trunc('month', now())::date, (date_trunc('month', now())+interval '1 month - 1 day')::date);
  select count(*) into v_lines from public.payout_orders where order_id = v_oid;
  if v_lines < 2 then raise exception 'FAIL payout: only % lines (need courier+restaurant)', v_lines; end if;

  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS operational-e2e: place->accept(ETA)->ready(offer)->claim->delivered(paid,float+%,% events)->payout(% lines) — full chain live', (v_bal1 - v_bal0), v_events, v_lines;
end $$;
