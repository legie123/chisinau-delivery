-- Wave D1 — a platform_admin can reassign a stuck in-flight order from a ghosting
-- courier to another available one: old courier released, new one assigned, live
-- offers cancelled, the move logged. Rolled back by runner.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_ca_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_cA uuid; v_cB uuid; v_item uuid; v_addr uuid; v_oid uuid; v_offer uuid;
  v_courier uuid; v_status text; v_ca_status text; v_cb_status text; v_events int; v_raised boolean;
begin
  -- Arrange open hours + item.
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;  -- deterministic: priciest modifier-free item (heap order is not stable)
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- cA = the (soon-to-ghost) assigned courier; cB = the free rescue courier.
  select id into v_cA from public.couriers where user_id = v_ca_user;
  select id into v_cB from public.couriers where id <> v_cA and is_active limit 1;
  -- neutralize residual float (armata 2026-08-13; cash-aware gate needs clean baseline)
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select c, 'refund_reversal', -public.courier_cash_balance(c), 'sim baseline zero (rolled back)'
  from unnest(array[v_cA, v_cB]) as c
  where public.courier_cash_balance(c) > 0;

  -- clear both of any seeded active deliveries, park everyone else offline.
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id in (v_cA, v_cB) and status in ('courier_assigned','picked_up','en_route');
  update public.couriers set status = 'offline' where id not in (v_cA, v_cB);
  update public.couriers set status = 'online', is_active = true where id in (v_cA, v_cB);
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_cA, 47.0245, 28.8322, now())
  on conflict (courier_id) do update set lat = 47.0245, lng = 28.8322, updated_at = now();
  update public.couriers set status = 'offline' where id = v_cB; -- keep cB out of dispatch so the offer goes to cA

  -- Drive an order to courier_assigned held by cA.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'card_on_delivery',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 3)), v_addr, null, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offer is null then raise exception 'FAIL D1 setup: no offer to cA'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ca_user,'role','authenticated')::text, true);
  perform public.accept_dispatch_offer(v_offer);

  select courier_id, status into v_courier, v_status from public.orders where id = v_oid;
  if v_courier <> v_cA or v_status <> 'courier_assigned' then raise exception 'FAIL D1 setup: order not assigned to cA (% / %)', v_courier, v_status; end if;

  -- cB becomes available for the rescue.
  update public.couriers set status = 'online' where id = v_cB;

  -- THE RESCUE: admin reassigns the stuck order from cA to cB.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.admin_reassign_courier(v_oid, v_cB);

  select courier_id, status into v_courier, v_status from public.orders where id = v_oid;
  select status into v_ca_status from public.couriers where id = v_cA;
  select status into v_cb_status from public.couriers where id = v_cB;
  select count(*) into v_events from public.delivery_status_events
    where order_id = v_oid and actor_role = 'platform_admin' and note like '%reatribuit%';

  if v_courier <> v_cB then raise exception 'FAIL D1: order not reassigned to cB (courier %)', v_courier; end if;
  if v_status <> 'courier_assigned' then raise exception 'FAIL D1: order status % after reassign', v_status; end if;
  if v_ca_status <> 'online' then raise exception 'FAIL D1: old courier not released (% expected online)', v_ca_status; end if;
  if v_cb_status <> 'on_delivery' then raise exception 'FAIL D1: new courier not on_delivery (%)', v_cb_status; end if;
  if v_events < 1 then raise exception 'FAIL D1: reassign not logged in the timeline'; end if;

  -- Guard: reassigning to the SAME (now current) courier must raise.
  v_raised := false;
  begin
    perform public.admin_reassign_courier(v_oid, v_cB);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL D1: reassign to the current courier was allowed'; end if;

  raise notice 'PASS D1: admin reassigned cA→cB (order courier_assigned, cA released online, cB on_delivery, logged); same-courier guard holds';
end $$;
