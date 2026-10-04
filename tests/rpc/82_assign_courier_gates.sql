-- 82: the pull path (assign_courier) enforces the gates dispatch_order does (migration
-- 20261004001100): online, scheduled window, cash-aware float. Found by the cross-app E2E audit:
-- an OFFLINE courier with no open shift could claim a waiting order.
do $$
declare
  c_rest constant uuid := '11111111-1111-1111-1111-111111111111';
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_partner constant uuid := 'a0000000-0000-0000-0000-000000000003';
  c_user constant uuid := 'c0000000-0000-0000-0000-000000000007';
  v_courier uuid; v_item uuid; v_addr uuid; v_oid uuid; v_sched uuid; v_msg text; v_status text;
begin
  select id into v_courier from public.couriers where user_id = c_user;
  delete from public.restaurant_hours where restaurant_id = c_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select c_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = c_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;
  select id into v_addr from public.addresses where customer_id = c_cust limit 1;

  update public.orders set status = 'cancelled', courier_id = null where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  update public.dispatch_offers set status = 'cancelled' where courier_id = v_courier and status = 'offered';
  update public.couriers set status = 'offline' where id <> v_courier;
  insert into public.courier_locations (courier_id, lat, lng, updated_at) values (v_courier, 47.0245, 28.8322, now())
    on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now(), is_plausible = true;
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_courier, 'refund_reversal', -public.courier_cash_balance(v_courier), 'sim baseline' where public.courier_cash_balance(v_courier) > 0;

  -- a normal order waiting in the pool, with no courier online (no live offer)
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  update public.couriers set status = 'offline' where id = v_courier;
  v_oid := public.place_order(c_rest, 'standard', 'cash', jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, 'sim82', null, gen_random_uuid()::text);
  perform set_config('request.jwt.claims', json_build_object('sub', c_partner, 'role', 'authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);

  -- 1. OFFLINE courier cannot claim
  perform set_config('request.jwt.claims', json_build_object('sub', c_user, 'role', 'authenticated')::text, true);
  begin
    perform public.assign_courier(v_oid);
    raise exception 'FAIL 82.1: an OFFLINE courier claimed the order';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'treci pe online%' then raise exception 'FAIL 82.1: wrong error: %', sqlerrm; end if;
  end;
  select status into v_status from public.orders where id = v_oid;
  if v_status <> 'ready_for_pickup' then raise exception 'FAIL 82.1b: order moved to % although the claim failed', v_status; end if;

  -- 2. an order scheduled > 45 min out cannot be claimed early (online courier)
  update public.couriers set status = 'online' where id = v_courier;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  v_sched := public.place_order(c_rest, 'standard', 'card_on_delivery', jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, now() + interval '3 hours', 'sim82-sched', null, gen_random_uuid()::text);
  update public.orders set status = 'ready_for_pickup' where id = v_sched;
  perform set_config('request.jwt.claims', json_build_object('sub', c_user, 'role', 'authenticated')::text, true);
  begin
    perform public.assign_courier(v_sched);
    raise exception 'FAIL 82.2: a scheduled order (3 h out) was claimed now';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'comandă programată%' then raise exception 'FAIL 82.2: wrong error: %', sqlerrm; end if;
  end;

  -- 3. cash-aware: a float near the cap refuses a standard cash order
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note) values (v_courier, 'collected', 1400, 'sim82 near-cap float');
  update public.couriers set status = 'online' where id = v_courier;
  begin
    perform public.assign_courier(v_oid);
    raise exception 'FAIL 82.3: a courier at 1400 MDL float claimed a cash order';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'plafonul de numerar%' then raise exception 'FAIL 82.3: wrong error: %', sqlerrm; end if;
  end;
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note) values (v_courier, 'refund_reversal', -1400, 'sim82 clear');

  -- 4. an online courier within the gates claims; the same-courier retry is idempotent
  perform public.assign_courier(v_oid);
  perform public.assign_courier(v_oid);
  select status into v_status from public.orders where id = v_oid and courier_id = v_courier;
  if v_status is distinct from 'courier_assigned' then raise exception 'FAIL 82.4: the online courier could not claim (status %)', v_status; end if;
  raise notice 'PASS 82: assign_courier refuses offline / scheduled-early / over-cap claims; online claim + idempotent retry work';
end $$;
