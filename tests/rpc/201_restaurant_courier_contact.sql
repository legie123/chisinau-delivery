-- Restaurant ↔ courier contact (migration 20261012000302_restaurant_courier_contact).
-- The partner cannot read `couriers` under RLS, so the pickup card showed no name at
-- all. restaurant_courier_contact(order) returns first name + phone to the order's
-- own restaurant only while courier_assigned / picked_up / en_route (owner decision
-- 2026-10-11). Rolled back by runner.
do $$
declare
  c_partner uuid := 'a0000000-0000-0000-0000-000000000003'; -- staffed at Sakura
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  c_foreign uuid := 'd0000000-0000-0000-0000-000000000003'; -- Nobu
  v_courier uuid; v_phone text; v_own uuid; v_other uuid; v_n int; v_first text; v_got_phone text;
begin
  select id, phone into v_courier, v_phone from public.couriers where user_id = c_courier_user;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, c_rest, 'courier_assigned', 'cash', 'unpaid', 200, 30, 230, v_courier)
  returning id into v_own;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, c_foreign, 'courier_assigned', 'cash', 'unpaid', 200, 30, 230, v_courier)
  returning id into v_other;

  perform set_config('request.jwt.claims', json_build_object('sub', c_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- R1: own restaurant, courier_assigned → first name + phone
  select first_name, phone into v_first, v_got_phone from public.restaurant_courier_contact(v_own);
  if v_first is null or v_first = '' then raise exception 'R1: no first name'; end if;
  if v_got_phone is distinct from v_phone then raise exception 'R1: phone % want %', v_got_phone, v_phone; end if;

  -- R2: another restaurant's order → 0 rows
  select count(*) into v_n from public.restaurant_courier_contact(v_other);
  if v_n <> 0 then raise exception 'R2: foreign order returned % rows', v_n; end if;

  -- R3: outside the window (delivered / ready_for_pickup) → 0 rows
  reset role;
  update public.orders set status = 'delivered', delivered_at = now() where id = v_own;
  set local role authenticated;
  select count(*) into v_n from public.restaurant_courier_contact(v_own);
  if v_n <> 0 then raise exception 'R3: delivered order still returns contact'; end if;
  reset role;
  update public.orders set status = 'picked_up', delivered_at = null where id = v_own;
  set local role authenticated;
  select count(*) into v_n from public.restaurant_courier_contact(v_own);
  if v_n <> 1 then raise exception 'R3b: picked_up should return contact'; end if;

  -- R4: the customer of the order gets nothing through this RPC
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.restaurant_courier_contact(v_own);
  if v_n <> 0 then raise exception 'R4: customer got restaurant contact rows'; end if;

  -- R5: anon cannot execute
  reset role;
  if has_function_privilege('anon', 'public.restaurant_courier_contact(uuid)', 'execute') then
    raise exception 'R5: anon can execute'; end if;

  raise notice 'restaurant courier contact R1-R5 OK';
end $$;
