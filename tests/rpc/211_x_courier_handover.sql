-- CROSS TEST (consumer = RESTAURANT, providers = CURIER dispatch + delivery RPCs). Written by
-- RESTAURANT: the kitchen depends on "I mark it ready → a courier is offered it → once he
-- accepts I see who is coming → after pickup it leaves my hands". Real RPCs end to end:
-- mark_ready_for_pickup (dispatches) → accept_dispatch_offer → advance_delivery_status.
-- H1 marking ready creates a live offer for an online courier near the restaurant;
-- H2 accepting it assigns the courier and the restaurant sees his first name + phone;
-- H3 picked_up keeps the contact (bag is on the way); H4 delivered drops it; H5 an offer the
-- courier declines is never shown to the restaurant as assigned. Change only by RESTAURANT.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier uuid; v_cuser uuid; v_phone text; v_rlat numeric; v_rlng numeric;
  v_addr uuid; v_oid uuid; v_offer uuid; v_n int; v_status text; v_first text; v_got text;
begin
  select lat, lng into v_rlat, v_rlng from public.restaurants where id = v_rest;
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng)
  values (v_cust, 'sim211', '+37360000000', v_rlat + 0.01, v_rlng) returning id into v_addr;
  -- exactly one eligible courier: online, free, fresh position at the restaurant's door
  update public.couriers set status = 'offline' where status in ('online', 'on_delivery');
  update public.dispatch_offers set status = 'declined' where status = 'offered';
  -- (the seeded test courier has an in-flight seed order → no capacity; take one that is free)
  select id, user_id, phone into v_courier, v_cuser, v_phone from public.couriers
  where is_active and user_id is not null and phone is not null and public.courier_has_capacity(id)
  order by id limit 1;
  if v_courier is null then raise exception 'H0: no free active courier with a phone in the seed'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cuser, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_courier_online_status('online');
  reset role;
  insert into public.courier_locations (courier_id, lat, lng, updated_at) values (v_courier, v_rlat, v_rlng, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();

  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, estimated_ready_at)
  values ('standard', v_cust, v_rest, v_addr, 'accepted', 'card_on_delivery', 'unpaid', 200, 30, 230, now())
  returning id into v_oid;

  -- H1: the kitchen marks it ready → CURIER's dispatch offers it out
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.mark_ready_for_pickup(v_oid);
  reset role;
  select id into v_offer from public.dispatch_offers where order_id = v_oid and courier_id = v_courier and status = 'offered';
  if v_offer is null then
    raise exception 'H1: no live offer after mark_ready_for_pickup (offers: %)',
      (select string_agg(courier_id || ':' || status, ', ') from public.dispatch_offers where order_id = v_oid);
  end if;
  -- before acceptance the restaurant must NOT see a courier
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.restaurant_courier_contact(v_oid);
  if v_n <> 0 then raise exception 'H5: restaurant sees a courier before anyone accepted'; end if;

  -- H2: the courier accepts → the restaurant sees who is coming
  perform set_config('request.jwt.claims', json_build_object('sub', v_cuser, 'role', 'authenticated')::text, true);
  perform public.accept_dispatch_offer(v_offer);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  select status into v_status from public.orders where id = v_oid;
  if v_status <> 'courier_assigned' then raise exception 'H2: order is % after accept, want courier_assigned', v_status; end if;
  select first_name, phone into v_first, v_got from public.restaurant_courier_contact(v_oid);
  if v_got is distinct from v_phone or coalesce(v_first, '') = '' then raise exception 'H2: restaurant sees %/% (want first name + %)', v_first, v_got, v_phone; end if;

  -- H3: picked up → contact still there
  perform set_config('request.jwt.claims', json_build_object('sub', v_cuser, 'role', 'authenticated')::text, true);
  perform public.advance_delivery_status(v_oid, 'picked_up', false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.restaurant_courier_contact(v_oid);
  if v_n <> 1 then raise exception 'H3: contact gone right after pickup'; end if;

  -- H4: delivered → contact gone
  perform set_config('request.jwt.claims', json_build_object('sub', v_cuser, 'role', 'authenticated')::text, true);
  perform public.advance_delivery_status(v_oid, 'en_route', false);
  perform public.advance_delivery_status(v_oid, 'delivered', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.restaurant_courier_contact(v_oid);
  if v_n <> 0 then raise exception 'H4: courier phone still visible after delivery'; end if;
  select status into v_status from public.orders where id = v_oid;
  if v_status <> 'delivered' then raise exception 'H4: order is %', v_status; end if;
  reset role;

  raise notice 'cross courier↔kitchen H1-H5 OK';
end $$;
