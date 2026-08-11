-- Dispatch cooldown — audit 2026-08-11 HIGH. The lifetime exclusion (hard
-- unique on order_id+courier_id) meant one missed 30s offer permanently
-- removed the only online courier from an order's dispatch pool — fatal in a
-- 1-3 courier pilot. New rule: an EXPIRED offer older than 2 minutes makes
-- the courier eligible again; a DECLINED offer stays a permanent no.
-- C1: within 2 min of expiry -> still excluded (no offer spam).
-- C2: after the cooldown -> re-offered (the dead-end is gone).
-- C3: declined -> never re-offered, cooldown or not.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid; v_item uuid; v_addr uuid; v_oid uuid; v_qty int;
  v_offer uuid; v_n int;
begin
  -- Arrange (05's pattern): open hours, single online courier, clean slate
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select mi.id, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int
    into v_item, v_qty
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  select id into v_courier from public.couriers where user_id = v_courier_user;
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_courier, 'offload', -public.courier_cash_balance(v_courier), 'sim baseline reset (rolled back)'
  where public.courier_cash_balance(v_courier) > 0;
  update public.couriers set status = 'offline' where id <> v_courier;
  update public.couriers set status = 'online', is_active = true, consecutive_ignored_offers = 0 where id = v_courier;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier, 47.0245, 28.8322, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();

  -- place -> accept -> ready (fires wave 1 offer to our courier)
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  perform set_config('request.jwt.claims', null, true);

  select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offer is null then raise exception 'FAIL arrange: no wave-1 offer'; end if;

  -- ===== C1: offer expires (missed, not declined); within cooldown -> excluded =====
  update public.dispatch_offers set status = 'expired', expires_at = now() - interval '10 seconds',
         created_at = now() - interval '40 seconds'
  where id = v_offer;
  perform public.dispatch_order(v_oid);
  select count(*) into v_n from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_n > 0 then raise exception 'FAIL C1: re-offered the same courier only seconds after expiry'; end if;
  raise notice 'PASS C1: no offer spam inside the cooldown';

  -- ===== C2: cooldown passed -> the only courier becomes eligible again =====
  update public.dispatch_offers set expires_at = now() - interval '3 minutes',
         created_at = now() - interval '4 minutes'
  where id = v_offer;
  perform public.dispatch_order(v_oid);
  select count(*) into v_n from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_n = 0 then raise exception 'FAIL C2: courier still excluded after cooldown — the single-courier dead-end lives'; end if;
  raise notice 'PASS C2: expired offer re-offered after the 2-min cooldown';

  -- ===== C3: a DECLINE is a permanent no =====
  update public.dispatch_offers set status = 'declined', expires_at = now() - interval '3 minutes',
         created_at = now() - interval '4 minutes'
  where order_id = v_oid;
  perform public.dispatch_order(v_oid);
  select count(*) into v_n from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_n > 0 then raise exception 'FAIL C3: re-offered an order the courier explicitly declined'; end if;
  raise notice 'PASS C3: declines stay permanent';
end $$;

-- ===== Z: zombie ready orders expire instead of hunting the courier forever =====
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_addr uuid; v_oid uuid; v_qty int; v_status text; v_n int;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select mi.id, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int into v_item, v_qty
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', null, true);

  -- force it into a 7h-old ready_for_pickup state with no courier
  update public.orders set status = 'ready_for_pickup' where id = v_oid;
  insert into public.delivery_status_events (order_id, status, actor_role, note)
  values (v_oid, 'ready_for_pickup', 'system', 'sim'), (v_oid, 'ready_for_pickup', 'system', 'sim');
  update public.delivery_status_events set created_at = now() - interval '7 hours' where order_id = v_oid;
  update public.orders set created_at = now() - interval '8 hours' where id = v_oid;

  perform public.expire_stale_orders();
  select status into v_status from public.orders where id = v_oid;
  if v_status <> 'cancelled' then
    raise exception 'FAIL Z1: 7h-old courier-less ready order is still %, will zombie-hunt the courier', v_status;
  end if;
  raise notice 'PASS Z1: zombie ready order expired by the sweeper';

  -- a FRESH ready order must NOT be touched
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', null, true);
  update public.orders set status = 'ready_for_pickup' where id = v_oid;
  insert into public.delivery_status_events (order_id, status, actor_role, note)
  values (v_oid, 'ready_for_pickup', 'system', 'sim');
  perform public.expire_stale_orders();
  select status into v_status from public.orders where id = v_oid;
  if v_status <> 'ready_for_pickup' then
    raise exception 'FAIL Z2: fresh ready order was wrongly expired (%)', v_status;
  end if;
  raise notice 'PASS Z2: fresh ready order untouched';
end $$;
