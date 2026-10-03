-- Scheduled orders ("Programează livrarea") honesty — audit 2026-08-11 CRIT.
-- A customer schedules for tomorrow; today the system treats it as a live ASAP
-- order end-to-end: the accept-SLA sweeper auto-cancels it minutes after
-- placement, and mark_ready fires dispatch ~14h before the requested window.
-- S1: sweeper must NOT cancel a far-future scheduled order on the created_at clock.
-- S2: dispatch must NOT offer a scheduled order outside its window.
-- S3: once inside the window, dispatch offers normally (gate opens).

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';       -- Sakura (partner a...03 is staff)
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid; v_item uuid; v_addr uuid; v_oid uuid; v_oid2 uuid; v_qty int;
  v_status text; v_offers int;
begin
  -- Arrange: open hours, one online courier as the only candidate (05's pattern)
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  select mi.id, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int
    into v_item, v_qty
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
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
  -- Parchează orice comandă ready REZIDUALĂ din DB-ul viu: rescue-ul din
  -- expire_dispatch_offers (S2b) ar dispeceriza-o către singurul curier online
  -- și i-ar ocupa slotul de ofertă, închizând dispatch-ul pentru S3 (rollback).
  update public.orders set status = 'cancelled' where status = 'ready_for_pickup';
  update public.couriers set status = 'offline' where id <> v_courier;
  update public.couriers set status = 'online', is_active = true where id = v_courier;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier, 47.0245, 28.8322, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();

  -- ===== S1: scheduled tomorrow, placed 30 min ago, restaurant silent =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr,
    now() + interval '20 hours', null, null);
  perform set_config('request.jwt.claims', null, true);
  update public.orders set created_at = now() - interval '30 minutes' where id = v_oid;

  perform public.expire_stale_orders();
  select status into v_status from public.orders where id = v_oid;
  if v_status <> 'pending_restaurant' then
    raise exception 'FAIL S1: scheduled-for-tomorrow order was % by the accept-SLA sweeper 20h before its window', v_status;
  end if;
  raise notice 'PASS S1: far-future scheduled order survives the accept-SLA sweeper';

  -- ===== S2: accepted + marked ready tonight -> NO dispatch offer outside window =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  perform set_config('request.jwt.claims', null, true);

  select count(*) into v_offers from public.dispatch_offers where order_id = v_oid;
  if v_offers > 0 then
    raise exception 'FAIL S2: dispatch offered a scheduled order % hours before its requested window', 20;
  end if;
  raise notice 'PASS S2: no dispatch offer outside the scheduled window';

  -- the sweeper's rescue path must respect the same gate
  perform public.expire_dispatch_offers();
  select count(*) into v_offers from public.dispatch_offers where order_id = v_oid;
  if v_offers > 0 then
    raise exception 'FAIL S2b: the sweeper rescue-dispatched a scheduled order outside its window';
  end if;
  raise notice 'PASS S2b: sweeper rescue respects the scheduled window';

  -- ===== S3: inside the window the gate opens =====
  update public.orders set requested_for = now() + interval '20 minutes' where id = v_oid;
  perform public.dispatch_order(v_oid);
  select count(*) into v_offers from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offers = 0 then
    raise exception 'FAIL S3: dispatch stayed closed for an order inside its scheduled window';
  end if;
  raise notice 'PASS S3: dispatch opens inside the scheduled window';
end $$;
