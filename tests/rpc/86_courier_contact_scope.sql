-- Courier contact scope (migration 20261008000300_courier_contact_scope).
-- Before: couriers_customer_scoped_read let a customer SELECT * on any courier who
-- EVER delivered to them — forever, and every column (status / online presence,
-- consecutive_ignored_offers, user_id, rating, referral code). After: no direct
-- customer read at all; order_courier_contact(order) returns first name + phone only
-- for the caller's own order while it is courier_assigned / picked_up / en_route.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_other uuid := 'a0000000-0000-0000-0000-000000000003';   -- partner user, not this order's customer
  c_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  c_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_rest uuid; v_courier uuid; v_full text; v_old uuid; v_live uuid; v_n int; v_first text; v_phone text;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select id, full_name into v_courier, v_full from public.couriers where user_id = c_courier_user;
  -- arrange: the customer has NO in-flight order with this courier, only a delivered one
  update public.orders set status = 'cancelled' where customer_id = c_cust and courier_id = v_courier
    and status in ('courier_assigned', 'picked_up', 'en_route');
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, delivered_at)
  values ('standard', c_cust, v_rest, 'delivered', 'cash', 'paid', 200, 30, 230, v_courier, now() - interval '3 days')
  returning id into v_old;

  -- ===== K1: a past delivery gives no read on the couriers table =====
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.couriers where id = v_courier;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 86.K1: customer reads the couriers row (status, ignored offers, user_id) after a delivered order'; end if;
  raise notice 'PASS 86.K1: delivered order -> no courier row';

  -- ===== K2: active order -> still no table row, but the RPC returns first name + phone =====
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, 'courier_assigned', 'cash', 'unpaid', 200, 30, 230, v_courier)
  returning id into v_live;
  set local role authenticated;
  select count(*) into v_n from public.couriers where id = v_courier;
  select first_name, phone into v_first, v_phone from public.order_courier_contact(v_live);
  reset role;
  if v_n <> 0 then raise exception 'FAIL 86.K2: customer reads operational courier columns during an active order'; end if;
  if v_first is distinct from split_part(v_full, ' ', 1) or v_phone is null then
    raise exception 'FAIL 86.K2: contact for the active order = (%, %), expected first name of %', v_first, v_phone, v_full;
  end if;
  raise notice 'PASS 86.K2: active order -> contact (% + phone) via RPC only', v_first;

  -- ===== K3: the RPC refuses a finished order and someone else's order =====
  set local role authenticated;
  select count(*) into v_n from public.order_courier_contact(v_old);
  reset role;
  if v_n <> 0 then raise exception 'FAIL 86.K3: contact returned for a delivered order'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.order_courier_contact(v_live);
  reset role;
  if v_n <> 0 then raise exception 'FAIL 86.K3: contact returned to a non-owner'; end if;
  if has_function_privilege('anon', 'public.order_courier_contact(uuid)', 'EXECUTE') then
    raise exception 'FAIL 86.K3: anon can execute order_courier_contact';
  end if;
  raise notice 'PASS 86.K3: finished / foreign / anon -> nothing';

  -- ===== K4: courier self-read and admin read unchanged =====
  perform set_config('request.jwt.claims', json_build_object('sub', c_courier_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.couriers where user_id = c_courier_user;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 86.K4: courier cannot read own row (%)', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.couriers;
  reset role;
  if v_n < 1 then raise exception 'FAIL 86.K4: admin reads no couriers'; end if;
  raise notice 'PASS 86.K4: courier self-read + admin read intact (% rows)', v_n;
end $$;
