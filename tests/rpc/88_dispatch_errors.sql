-- Dispatch failures are recorded, not swallowed (migration 20261011000100_dispatch_errors).
-- expire_dispatch_offers() (pg_cron, 15s) wraps each dispatch_order() call in
-- `exception when others then null`, so an order that always fails to dispatch sat in
-- ready_for_pickup with no offer and nobody saw why. After the fix every failure lands in
-- dispatch_errors: one row per (order, error code), count and last_at bumped on repeats, so a
-- permanently failing order cannot flood the table at 4 rows a minute.
-- dispatch_order is replaced by a raising stub INSIDE this rolled-back transaction.
create or replace function public.dispatch_order(p_order_id uuid) returns uuid
language plpgsql as $$ begin raise exception 'sim88 boom' using errcode = 'P0088'; end $$;

do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_addr uuid; v_oid uuid; v_oid2 uuid; v_courier uuid;
  v_n int; v_cnt int; v_msg text; v_admin uuid; v_seen int;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng, contact_phone)
  values (c_cust, 'Str. Sim 88', 47.02, 28.83, '069000088') returning id into v_addr;

  -- ===== E1: sweep phase (ready, no live offer) records the failure =====
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230)
  returning id into v_oid;
  perform public.expire_dispatch_offers();
  select count, message into v_cnt, v_msg from public.dispatch_errors where order_id = v_oid and error_code = 'P0088';
  if v_cnt is distinct from 1 or v_msg not like '%sim88 boom%' then
    raise exception 'FAIL 88.E1: sweep failure not recorded (count %, message %)', v_cnt, v_msg;
  end if;
  raise notice 'PASS 88.E1: sweep-phase failure recorded once';

  -- ===== E2: the next tick bumps the same row, no second row =====
  perform public.expire_dispatch_offers();
  select count(*), max(count) into v_n, v_cnt from public.dispatch_errors where order_id = v_oid;
  if v_n <> 1 or v_cnt <> 2 then raise exception 'FAIL 88.E2: % rows, count % (want 1 row, count 2)', v_n, v_cnt; end if;
  raise notice 'PASS 88.E2: repeat failure bumps count on one row';

  -- ===== E3: expire phase (an offer just timed out) records too =====
  select id into v_courier from public.couriers order by id limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 150, 30, 180)
  returning id into v_oid2;
  insert into public.dispatch_offers (order_id, courier_id, score, status, offered_at, expires_at)
  values (v_oid2, v_courier, 1, 'offered', now() - interval '2 minutes', now() - interval '1 minute');
  perform public.expire_dispatch_offers();
  if not exists (select 1 from public.dispatch_errors where order_id = v_oid2 and error_code = 'P0088') then
    raise exception 'FAIL 88.E3: expire-phase failure not recorded';
  end if;
  raise notice 'PASS 88.E3: expire-phase failure recorded';

  -- ===== E4: customers cannot read it, admins can =====
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from public.dispatch_errors;
  reset role;
  if v_seen <> 0 then raise exception 'FAIL 88.E4: customer sees % dispatch_errors rows', v_seen; end if;
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from public.dispatch_errors where order_id in (v_oid, v_oid2);
  reset role;
  if v_seen <> 2 then raise exception 'FAIL 88.E4: admin sees % of 2 rows', v_seen; end if;
  raise notice 'PASS 88.E4: customer 0 rows, admin sees both';
end $$;
