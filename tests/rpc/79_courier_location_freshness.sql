-- 79: the restaurant and the customer see the courier's position only from the CURRENT leg
-- (migrations 20261004000700 + 20261004000800). The restaurant: points recorded since the order's
-- latest courier_assigned event — never the previous delivery's last point (the previous customer's
-- door, shown as live with an ETA), but a courier standing still at the pickup stays visible
-- however old his last point is. The customer: points since the order's picked_up event.
do $$
declare
  c_order constant uuid := 'e0000000-0000-0000-0000-000000000017'; -- seeded, courier_assigned
  v_courier uuid;
  v_courier_user uuid;
  v_rest uuid;
  v_customer uuid;
  v_partner uuid;
  v_n int;
begin
  select o.courier_id, o.restaurant_id, o.customer_id into v_courier, v_rest, v_customer
  from public.orders o where o.id = c_order and o.status = 'courier_assigned';
  if v_courier is null then raise exception 'FAIL 79.0: seeded order % is not courier_assigned', c_order; end if;
  select user_id into v_courier_user from public.couriers where id = v_courier;
  select user_id into v_partner from public.restaurant_staff where restaurant_id = v_rest limit 1;

  -- this leg started 10 minutes ago
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, created_at)
  values (c_order, 'courier_assigned', 'courier', v_courier_user, now() - interval '10 minutes');

  -- the previous delivery's last point, recorded before this leg (set_updated_at would stamp now())
  alter table public.courier_locations disable trigger user;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier, 47.0412, 28.8123, now() - interval '20 minutes')
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = excluded.updated_at;
  alter table public.courier_locations enable trigger user;

  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.courier_locations where courier_id = v_courier;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 79.1: the restaurant sees the previous delivery''s last point as the courier''s position'; end if;

  -- standing still at the restaurant: his last point is from this leg but 5 minutes old
  alter table public.courier_locations disable trigger user;
  update public.courier_locations set lat = 47.0200, updated_at = now() - interval '5 minutes' where courier_id = v_courier;
  alter table public.courier_locations enable trigger user;
  set local role authenticated;
  select count(*) into v_n from public.courier_locations where courier_id = v_courier;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 79.2: a courier waiting at the restaurant vanished from its map (point 5 min old, after the assignment)'; end if;

  -- after pickup: the customer sees only points from the delivery leg
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.advance_delivery_status(c_order, 'picked_up', null);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.courier_locations where courier_id = v_courier;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 79.3: the customer sees a point from before the pickup'; end if;

  update public.courier_locations set lat = 47.0300 where courier_id = v_courier; -- a fix after pickup (now())
  set local role authenticated;
  select count(*) into v_n from public.courier_locations where courier_id = v_courier;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 79.4: the customer does not see the courier after pickup'; end if;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 79: restaurant and customer see only points from the current leg; a courier standing still stays visible';
end $$;
