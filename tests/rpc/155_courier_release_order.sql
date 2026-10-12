-- System scenario 5 (gate I3): the courier gives up after accepting (migration 20261012000209).
-- Before pickup: allowed within the daily cap from courier_release_policy; the order goes back to ready_for_pickup,
-- is re-offered at once to ANOTHER courier, the releasing courier is online again, the timeline shows it.
-- After pickup: refused (support only). No penalty: releases are not read by dispatch_order.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_rest uuid; v_rlat numeric; v_rlng numeric; v_addr uuid;
  v_a uuid; v_ua uuid; v_b uuid; v_ub uuid; v_o uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid;
  v_left int; v_to uuid; v_st text; v_courier uuid; n int; v_msg text; v_ok boolean;
begin
  select id, lat, lng into v_rest, v_rlat, v_rlng from public.restaurants where is_active and lat is not null order by name limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 155', v_rlat + 0.01, v_rlng) returning id into v_addr;
  update public.couriers set status = 'offline' where status = 'online';
  select id, user_id into v_a, v_ua from public.couriers where is_active and public.courier_has_capacity(id) order by id limit 1;
  select id, user_id into v_b, v_ub from public.couriers where is_active and public.courier_has_capacity(id) and id <> v_a order by id limit 1;
  update public.couriers set status = 'online', vehicle_type = 'bike' where id = v_b;
  update public.couriers set status = 'on_delivery' where id = v_a;
  update public.dispatch_offers set status = 'declined' where courier_id in (v_a, v_b) and status = 'offered';
  delete from public.courier_locations where courier_id in (v_a, v_b);
  insert into public.courier_locations (courier_id, lat, lng, is_plausible) values (v_b, v_rlat + 0.004, v_rlng, true);
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, courier_arrived_restaurant_at)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'cash', 'unpaid', 200, 30, 230, v_a, now()) returning id into v_o;
  -- A's accepted offer, as accept_dispatch_offer leaves it (dispatch_order skips A for this order because of it)
  insert into public.dispatch_offers (order_id, courier_id, score, distance_km, status, expires_at, responded_at)
  values (v_o, v_a, 1, 0.5, 'accepted', now() - interval '1 minute', now() - interval '1 minute');

  -- ===== R1: release before pickup: order back to ready, re-offered to ANOTHER courier, A online again =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_left := public.courier_release_order(v_o, 'vehicle_problem');
  reset role;
  select status, courier_id into v_st, v_courier from public.orders where id = v_o;
  if v_st <> 'ready_for_pickup' or v_courier is not null then raise exception 'FAIL 155.R1: order % / courier %', v_st, v_courier; end if;
  if (select courier_arrived_restaurant_at from public.orders where id = v_o) is not null then raise exception 'FAIL 155.R1: arrival of the leaving courier kept'; end if;
  if (select status from public.couriers where id = v_a) <> 'online' then raise exception 'FAIL 155.R1: releasing courier not back online'; end if;
  select courier_id into v_to from public.dispatch_offers where order_id = v_o and status = 'offered';
  if v_to is distinct from v_b then raise exception 'FAIL 155.R1: re-offered to % (expected the other courier)', v_to; end if;
  select count(*) into n from public.delivery_status_events where order_id = v_o and status = 'ready_for_pickup' and actor_role = 'courier';
  if n <> 1 then raise exception 'FAIL 155.R1: % release events in the timeline', n; end if;
  if v_left <> (select daily_cap from public.current_courier_release_policy()) - 1 then raise exception 'FAIL 155.R1: % left', v_left; end if;
  raise notice 'PASS 155.R1: released before pickup -> ready, re-offered to the other courier, A online, event, % left today', v_left;

  -- ===== R2: after pickup -> refused, nothing changes =====
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'picked_up', 'cash', 'unpaid', 200, 30, 230, v_a) returning id into v_o2;
  set local role authenticated;
  begin
    perform public.courier_release_order(v_o2, 'vehicle_problem');
    reset role; raise exception 'FAIL 155.R2: release after pickup accepted';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  if (select status from public.orders where id = v_o2) <> 'picked_up' then raise exception 'FAIL 155.R2: order changed'; end if;
  if v_msg not like '%suport%' then raise exception 'FAIL 155.R2: refusal does not send the courier to support (%)', v_msg; end if;
  raise notice 'PASS 155.R2: after pickup refused (%)', v_msg;

  -- ===== R3: daily cap (from the versioned policy); yesterday's releases do not count =====
  insert into public.courier_release_policy (effective_from, daily_cap, note) values (now() - interval '1 second', 2, 'sim 155');
  insert into public.courier_order_releases (order_id, courier_id, reason, created_at)
  values (v_o2, v_a, 'other', now() - interval '2 days');   -- an old one: never counts
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'cash', 'unpaid', 200, 30, 230, v_a) returning id into v_o3;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'cash', 'unpaid', 200, 30, 230, v_a) returning id into v_o4;
  set local role authenticated;
  v_left := public.courier_release_order(v_o3, 'personal_emergency');   -- 2nd today (cap 2)
  reset role;
  if v_left <> 0 then raise exception 'FAIL 155.R3: % left after the 2nd of 2', v_left; end if;
  set local role authenticated;
  begin
    perform public.courier_release_order(v_o4, 'other');
    reset role; raise exception 'FAIL 155.R3: release above the daily cap accepted';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  if (select courier_id from public.orders where id = v_o4) is distinct from v_a then raise exception 'FAIL 155.R3: capped order lost its courier'; end if;
  raise notice 'PASS 155.R3: cap 2 -> the 3rd release today refused (%), yesterday''s not counted', v_msg;

  -- ===== R4: another courier, the customer and anon cannot release; an unknown reason is refused =====
  insert into public.courier_release_policy (effective_from, daily_cap, note) values (now(), 10, 'sim 155 room');
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'cash', 'unpaid', 200, 30, 230, v_a) returning id into v_o5;
  foreach v_ub in array array[v_ub, c_cust] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.courier_release_order(v_o5, 'other');
      reset role; raise exception 'FAIL 155.R4: % released someone else''s order', v_ub;
    exception when raise_exception then
      get stacked diagnostics v_msg = message_text; reset role;
      if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
    end;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform public.courier_release_order(v_o5, 'other');
    reset role; raise exception 'FAIL 155.R4: anon executed courier_release_order';
  exception when insufficient_privilege then reset role;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.courier_release_order(v_o5, 'bored');
    reset role; raise exception 'FAIL 155.R4: unknown reason accepted';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  if (select courier_id from public.orders where id = v_o5) is distinct from v_a then raise exception 'FAIL 155.R4: order changed hands'; end if;
  raise notice 'PASS 155.R4: other courier, customer, anon and an unknown reason refused';

  -- ===== R5: reads — A sees its releases, B and the customer see none, admin sees all =====
  set local role authenticated;
  select count(*) into n from public.courier_order_releases where courier_id = v_a;
  reset role;
  if n < 3 then raise exception 'FAIL 155.R5: owner sees % releases', n; end if;
  foreach v_ub in array array[(select user_id from public.couriers where id = v_b), c_cust] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.courier_order_releases where courier_id = v_a;
    reset role;
    if n <> 0 then raise exception 'FAIL 155.R5: % sees % of A''s releases', v_ub, n; end if;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.courier_order_releases where courier_id = v_a;
  reset role;
  if n < 3 then raise exception 'FAIL 155.R5: admin sees % releases', n; end if;
  raise notice 'PASS 155.R5: owner and admin read, other courier and customer read nothing';

  -- ===== R6: the policy is versioned and only an admin sets it =====
  begin
    update public.courier_release_policy set daily_cap = 99;
    raise exception 'FAIL 155.R6: a policy row was edited';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_courier_release_policy(50, 'courier tries');
    reset role; raise exception 'FAIL 155.R6: a courier set the policy';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_courier_release_policy(4, 'admin');
  reset role;
  raise notice 'PASS 155.R6: policy rows immutable; courier refused, admin adds a version';

  -- ===== R7: the written ROLLBACK works =====
  delete from public.dispatch_errors where phase = 'release';
  drop function public.courier_release_order(uuid, text);
  drop function public.set_courier_release_policy(integer, text);
  drop function public.current_courier_release_policy();
  drop table public.courier_order_releases;
  drop table public.courier_release_policy;
  drop function public.guard_courier_release_policy_immutable();
  alter table public.dispatch_errors drop constraint dispatch_errors_phase_check,
    add constraint dispatch_errors_phase_check check (phase in ('expire', 'sweep'));
  select not exists (select 1 from pg_proc where proname in ('courier_release_order', 'current_courier_release_policy')) into v_ok;
  if not v_ok then raise exception 'FAIL 155.R7: rollback left functions'; end if;
  raise notice 'PASS 155.R7: rollback drops everything it added';
end $$;
