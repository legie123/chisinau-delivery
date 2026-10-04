-- 79: the restaurant and the customer see the courier's position only while it is fresh
-- (migration 20261004000700). A 52-day-old row — the previous delivery's last point — used to
-- show on the next restaurant's pickup map as the live courier.
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

  -- the previous delivery's last point, 52 days old (set_updated_at would stamp now())
  alter table public.courier_locations disable trigger user;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier, 47.0412, 28.8123, now() - interval '52 days')
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = excluded.updated_at;
  alter table public.courier_locations enable trigger user;

  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.courier_locations where courier_id = v_courier;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 79.1: the restaurant sees a 52-day-old courier position as live'; end if;

  update public.courier_locations set lat = 47.0200 where courier_id = v_courier; -- a fresh fix
  set local role authenticated;
  select count(*) into v_n from public.courier_locations where courier_id = v_courier;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 79.2: the restaurant does not see a fresh courier position'; end if;

  -- after pickup the customer sees it, only while fresh
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.advance_delivery_status(c_order, 'picked_up', null);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.courier_locations where courier_id = v_courier;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 79.3: the customer does not see the fresh position after pickup'; end if;

  alter table public.courier_locations disable trigger user;
  update public.courier_locations set updated_at = now() - interval '10 minutes' where courier_id = v_courier;
  alter table public.courier_locations enable trigger user;
  set local role authenticated;
  select count(*) into v_n from public.courier_locations where courier_id = v_courier;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 79.4: the customer sees a 10-minute-old position as live'; end if;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 79: restaurant and customer see the courier only while the position is fresh (2 min)';
end $$;
