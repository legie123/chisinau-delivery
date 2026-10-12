-- Release fixes (migration 20261012000210) + the cap edges sim 155 did not pin (verif-curier round 5).
-- X1 an admin-assigned order released by A is NOT re-offered to A (it used to be: no offer row excluded A)
-- X2 a replayed release answers like the first one and writes nothing
-- X3 delivered / cancelled orders cannot be released
-- X4 the cap counts only THIS courier's releases since LOCAL (Europe/Chisinau) midnight
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_rlat numeric; v_rlng numeric; v_addr uuid;
  v_a uuid; v_ua uuid; v_b uuid; v_o uuid; v_x uuid; v_y uuid; v_d uuid; v_c uuid;
  v_left int; v_left2 int; v_to uuid; n int; v_msg text; v_day timestamptz; v_st text;
begin
  select id, lat, lng into v_rest, v_rlat, v_rlng from public.restaurants where is_active and lat is not null order by name limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 158', v_rlat + 0.01, v_rlng) returning id into v_addr;
  update public.couriers set status = 'offline' where status = 'online';
  select id, user_id into v_a, v_ua from public.couriers where is_active and public.courier_has_capacity(id) order by id limit 1;
  select id into v_b from public.couriers where is_active and public.courier_has_capacity(id) and id <> v_a order by id limit 1;
  update public.dispatch_offers set status = 'declined' where courier_id in (v_a, v_b) and status = 'offered';
  delete from public.courier_locations where courier_id in (v_a, v_b);
  -- A is the CLOSEST eligible courier once back online: without the exclusion the order would go straight back to A
  insert into public.courier_locations (courier_id, lat, lng, is_plausible) values (v_a, v_rlat + 0.001, v_rlng, true), (v_b, v_rlat + 0.02, v_rlng, true);
  update public.couriers set status = 'online', vehicle_type = 'bike' where id = v_b;
  update public.couriers set status = 'on_delivery', vehicle_type = 'bike' where id = v_a;
  insert into public.courier_release_policy (effective_from, daily_cap, note) values (now() - interval '1 second', 2, 'sim 158');

  -- ===== X1: admin-assigned (no offer row), A releases -> the re-offer goes to B, never back to A =====
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'card_on_delivery', 'unpaid', 200, 30, 230, v_a) returning id into v_x;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_left := public.courier_release_order(v_x, 'vehicle_problem');
  reset role;
  select courier_id into v_to from public.dispatch_offers where order_id = v_x and status = 'offered';
  if v_to is distinct from v_b then raise exception 'FAIL 158.X1: re-offer went to % (A=% B=%)', v_to, v_a, v_b; end if;
  -- and the sweeper does not hand it back to A either once B's offer expires
  update public.dispatch_offers set expires_at = now() - interval '1 second' where order_id = v_x and status = 'offered';
  perform public.expire_dispatch_offers();
  select count(*) into n from public.dispatch_offers where order_id = v_x and courier_id = v_a and status = 'offered';
  if n <> 0 then raise exception 'FAIL 158.X1: the sweeper offered the released order back to A'; end if;
  raise notice 'PASS 158.X1: released order re-offered to the other courier, never back to the one who released it';

  -- ===== X2: the same release replayed (lost response) -> same answer, no new row, no error =====
  set local role authenticated;
  v_left2 := public.courier_release_order(v_x, 'vehicle_problem');
  reset role;
  select count(*) into n from public.courier_order_releases where order_id = v_x and courier_id = v_a;
  if v_left2 is distinct from v_left or n <> 1 then raise exception 'FAIL 158.X2: replay -> left % (first %), % rows', v_left2, v_left, n; end if;
  raise notice 'PASS 158.X2: replay answers % left like the first call, one row', v_left2;

  -- ===== X3: delivered and cancelled orders assigned to A cannot be released =====
  foreach v_st in array array['delivered', 'cancelled'] loop
    insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, delivered_at)
    values ('standard', c_cust, v_rest, v_addr, v_st, 'card_on_delivery', 'paid', 200, 30, 230, v_a,
            case when v_st = 'delivered' then now() end) returning id into v_d;
    set local role authenticated;
    begin
      perform public.courier_release_order(v_d, 'other');
      reset role; raise exception 'FAIL 158.X3: % order released', v_st;
    exception when raise_exception then
      get stacked diagnostics v_msg = message_text; reset role;
      if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
    end;
    if (select status from public.orders where id = v_d) <> v_st then raise exception 'FAIL 158.X3: % order changed', v_st; end if;
  end loop;
  raise notice 'PASS 158.X3: delivered and cancelled orders refused';

  -- ===== X4: cap 2 counts only A, only since local midnight =====
  v_day := date_trunc('day', now() at time zone 'Europe/Chisinau') at time zone 'Europe/Chisinau';
  delete from public.courier_order_releases where courier_id = v_a;            -- start the day clean (rollback restores)
  insert into public.courier_order_releases (order_id, courier_id, reason, created_at)
  select v_d, v_a, 'other', v_day - interval '1 minute' from generate_series(1, 3);   -- yesterday 23:59 local: never counts
  insert into public.courier_order_releases (order_id, courier_id, reason, created_at)
  select v_d, v_b, 'other', now() from generate_series(1, 3);                          -- another courier: never counts
  insert into public.courier_order_releases (order_id, courier_id, reason, created_at)
  values (v_d, v_a, 'other', v_day + interval '1 minute');                             -- today 00:01 local: counts
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'card_on_delivery', 'unpaid', 200, 30, 230, v_a) returning id into v_y;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'card_on_delivery', 'unpaid', 200, 30, 230, v_a) returning id into v_c;
  set local role authenticated;
  v_left := public.courier_release_order(v_y, 'other');   -- 2nd of 2 today
  reset role;
  if v_left <> 0 then raise exception 'FAIL 158.X4: % left after the 2nd of 2 (yesterday/other courier counted, or local midnight wrong)', v_left; end if;
  set local role authenticated;
  begin
    perform public.courier_release_order(v_c, 'other');
    reset role; raise exception 'FAIL 158.X4: 3rd release today accepted (cap 2)';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  raise notice 'PASS 158.X4: cap counts only this courier since local midnight (yesterday 23:59 and another courier ignored)';
end $$;
