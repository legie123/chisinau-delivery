-- Order 5 — PICKUP/DROP-OFF GEOFENCE HINT (soft hint only, never delivery
-- proof, zero coupling to advance_delivery_status). Sims: wrong-courier is
-- blocked, the assigned courier can record a pickup AND a dropoff hint on a
-- genuinely-active order (courier_assigned / en_route — NOT a delivered seed
-- order forced through an advance step, per phoenix review), the log is
-- append-only (update/delete raise), and purge_expired_pii deletes rows past
-- the 2-year retention window while keeping recent ones. Rolled back by runner.

do $$
declare
  v_ion_user uuid := 'c0000000-0000-0000-0000-000000000004';   -- Ion Bulgaru, assigned to order 4
  v_andrei_user uuid := 'c0000000-0000-0000-0000-000000000005'; -- Andrei Cazacu, assigned to order 6
  v_wrong_user uuid := 'c0000000-0000-0000-0000-000000000002';  -- Nicolae Bejan, NOT assigned to either
  v_ion_courier uuid;
  v_andrei_courier uuid;
  v_order4 uuid := 'e0000000-0000-0000-0000-000000000004'; -- Amber Bistro, restaurant lat/lng 47.068000/28.860000
  v_order6 uuid := 'e0000000-0000-0000-0000-000000000006'; -- Le Jardin -> client@test.md address 47.023500/28.831500
  v_raised boolean;
  v_pickup_id uuid;
  v_dropoff_id uuid;
  v_dist numeric;
  v_kind text;
  v_count int;
  v_old_id uuid;
begin
  select id into v_ion_courier from public.couriers where user_id = v_ion_user;
  select id into v_andrei_courier from public.couriers where user_id = v_andrei_user;

  -- ==== 0. genuinely-active baseline (not a reused delivered order) ====
  update public.orders set status = 'courier_assigned', courier_id = v_ion_courier where id = v_order4;
  update public.orders set status = 'en_route', courier_id = v_andrei_courier where id = v_order6;
  -- Coordonatele pot fi mutate din admin în DB-ul viu (RestaurantLocationControl
  -- demo a plimbat Amber Bistro ~13 km) — sim-ul își pinuiește etalonul singur.
  update public.restaurants set lat = 47.068000, lng = 28.860000
  where id = (select restaurant_id from public.orders where id = v_order4);
  update public.addresses set lat = 47.023500, lng = 28.831500
  where id = (select delivery_address_id from public.orders where id = v_order6);

  -- ==== 1. a courier NOT assigned to the order cannot record a geofence event ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_wrong_user,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.record_geofence_event(v_order4, 'pickup', 47.06815, 28.86015);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a non-assigned courier recorded a geofence event'; end if;

  select count(*) into v_count from public.geofence_events where order_id = v_order4;
  if v_count <> 0 then raise exception 'FAIL: the blocked call still wrote a row'; end if;

  -- ==== 2. invalid kind is rejected ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ion_user,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.record_geofence_event(v_order4, 'lunch_break', 47.06815, 28.86015);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: an invalid kind was accepted'; end if;

  -- ==== 3. the assigned courier records a PICKUP hint near the restaurant ====
  perform public.record_geofence_event(v_order4, 'pickup', 47.06815, 28.86015);
  select id, dist_m, kind into v_pickup_id, v_dist, v_kind
    from public.geofence_events where order_id = v_order4 order by created_at desc limit 1;
  if v_pickup_id is null then raise exception 'FAIL: pickup event was not recorded'; end if;
  if v_kind <> 'pickup' then raise exception 'FAIL: kind = % (expected pickup)', v_kind; end if;
  if v_dist > 150 then raise exception 'FAIL: server-computed dist_m = % (expected a small distance near the restaurant)', v_dist; end if;

  -- ==== 4. the assigned courier records a DROPOFF hint near the delivery address, on a DIFFERENT (en_route) order ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_andrei_user,'role','authenticated')::text, true);
  perform public.record_geofence_event(v_order6, 'dropoff', 47.02360, 28.83160);
  select id, dist_m, kind into v_dropoff_id, v_dist, v_kind
    from public.geofence_events where order_id = v_order6 order by created_at desc limit 1;
  if v_dropoff_id is null then raise exception 'FAIL: dropoff event was not recorded'; end if;
  if v_kind <> 'dropoff' then raise exception 'FAIL: kind = % (expected dropoff)', v_kind; end if;
  if v_dist > 150 then raise exception 'FAIL: server-computed dist_m = % (expected a small distance near the address)', v_dist; end if;

  -- ==== 5. append-only: UPDATE/DELETE on a recent row raises ====
  v_raised := false;
  begin update public.geofence_events set dist_m = 0 where id = v_pickup_id;
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: geofence_events UPDATE succeeded (must be append-only)'; end if;

  v_raised := false;
  begin delete from public.geofence_events where id = v_pickup_id;
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: geofence_events DELETE succeeded on a recent row (must be append-only)'; end if;

  -- ==== 6. retention purge: >2yr rows deleted, recent rows (incl. the ones
  --         just recorded above) survive ====
  insert into public.geofence_events (id, order_id, courier_id, kind, lat, lng, dist_m, created_at)
  values (gen_random_uuid(), v_order4, v_ion_courier, 'pickup', 47.068, 28.860, 5, now() - interval '3 years')
  returning id into v_old_id;

  perform public.purge_expired_pii();

  if exists (select 1 from public.geofence_events where id = v_old_id) then
    raise exception 'FAIL: purge_expired_pii kept a geofence_events row older than 2 years';
  end if;
  if not exists (select 1 from public.geofence_events where id = v_pickup_id) then
    raise exception 'FAIL: purge_expired_pii deleted a recent geofence_events row (pickup)';
  end if;
  if not exists (select 1 from public.geofence_events where id = v_dropoff_id) then
    raise exception 'FAIL: purge_expired_pii deleted a recent geofence_events row (dropoff)';
  end if;

  raise notice 'PASS geofence-events: wrong courier blocked, invalid kind rejected, pickup+dropoff recorded on genuinely-active orders with server-side distance, append-only against update/delete, purge removes >2yr rows while keeping recent ones';
end $$;
