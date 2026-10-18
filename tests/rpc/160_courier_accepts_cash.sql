-- Delivery preference "cash orders" (migration 20261012000212, ȚINTA row 93).
-- K1 control: A (closest, accepts cash by default) gets the cash offer — proves A is the top candidate
-- K2 A turns cash off through set_courier_accepts_cash(false) -> the next cash order goes to B, never A
-- K3 a card_on_delivery order is still offered to A
-- K4 another courier cannot change A's preference (the RPC has no target; a direct UPDATE changes 0 rows)
-- K5 refused while A is on_delivery; refused for a user with no courier row
-- K6 anon / viewer / PUBLIC have no EXECUTE; authenticated has
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_rlat numeric; v_rlng numeric; v_addr uuid;
  v_a uuid; v_ua uuid; v_b uuid; v_ub uuid; v_o uuid; v_to uuid; v_ret boolean; v_msg text; n int;
begin
  select id, lat, lng into v_rest, v_rlat, v_rlng from public.restaurants where is_active and lat is not null order by name limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 160', v_rlat + 0.01, v_rlng) returning id into v_addr;
  update public.couriers set status = 'offline' where status = 'online';
  -- two couriers with room for one more 230 MDL cash order under their cash cap (else the cap, not the preference, decides)
  select id, user_id into v_a, v_ua from public.couriers
    where is_active and public.courier_has_capacity(id)
      and public.courier_cash_balance(id) + 230 < public.effective_cash_cap(id) order by id limit 1;
  select id, user_id into v_b, v_ub from public.couriers
    where is_active and public.courier_has_capacity(id) and id <> v_a
      and public.courier_cash_balance(id) + 230 < public.effective_cash_cap(id) order by id limit 1;
  if v_b is null then raise exception 'FAIL 160.setup: need two couriers under their cash cap'; end if;
  update public.dispatch_offers set status = 'declined' where courier_id in (v_a, v_b) and status = 'offered';
  delete from public.courier_locations where courier_id in (v_a, v_b);
  insert into public.courier_locations (courier_id, lat, lng, is_plausible) values (v_a, v_rlat + 0.001, v_rlng, true), (v_b, v_rlat + 0.02, v_rlng, true);
  update public.couriers set status = 'online', vehicle_type = 'bike' where id in (v_a, v_b);
  if not (select accepts_cash from public.couriers where id = v_a) then raise exception 'FAIL 160.setup: default is not true'; end if;

  -- ===== K1: control, cash order -> A =====
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230) returning id into v_o;
  perform public.dispatch_order(v_o);
  select courier_id into v_to from public.dispatch_offers where order_id = v_o and status = 'offered';
  if v_to is distinct from v_a then raise exception 'FAIL 160.K1: control cash offer went to % (A=% B=%)', v_to, v_a, v_b; end if;
  update public.dispatch_offers set status = 'declined' where order_id = v_o;
  raise notice 'PASS 160.K1: with the default (accepts cash) the closest courier A gets the cash offer';

  -- ===== K2: A turns cash off -> a new cash order goes to B =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_ret := public.set_courier_accepts_cash(false);
  reset role;
  if v_ret is distinct from false or (select accepts_cash from public.couriers where id = v_a) then
    raise exception 'FAIL 160.K2: set_courier_accepts_cash(false) returned % / row not updated', v_ret;
  end if;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230) returning id into v_o;
  perform public.dispatch_order(v_o);
  select courier_id into v_to from public.dispatch_offers where order_id = v_o and status = 'offered';
  if v_to is distinct from v_b then raise exception 'FAIL 160.K2: cash offer went to % (A=% refused cash, B=%)', v_to, v_a, v_b; end if;
  update public.dispatch_offers set status = 'declined' where order_id = v_o;
  raise notice 'PASS 160.K2: A refuses cash -> the cash order goes to B, not A';

  -- ===== K3: a card_on_delivery order is still offered to A =====
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230) returning id into v_o;
  perform public.dispatch_order(v_o);
  select courier_id into v_to from public.dispatch_offers where order_id = v_o and status = 'offered';
  if v_to is distinct from v_a then raise exception 'FAIL 160.K3: card offer went to % (A=%)', v_to, v_a; end if;
  update public.dispatch_offers set status = 'declined' where order_id = v_o;
  raise notice 'PASS 160.K3: card_on_delivery is unaffected, A still gets it';

  -- ===== K4: B cannot change A's preference =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_ret := public.set_courier_accepts_cash(true);      -- only B's own row
  update public.couriers set accepts_cash = true where id = v_a;   -- RLS: no update policy for a courier
  get diagnostics n = row_count;
  reset role;
  if n <> 0 or (select accepts_cash from public.couriers where id = v_a) then
    raise exception 'FAIL 160.K4: B changed A''s preference (direct update rows=%)', n;
  end if;
  if not (select accepts_cash from public.couriers where id = v_b) then raise exception 'FAIL 160.K4: B''s own call did not land on B'; end if;
  raise notice 'PASS 160.K4: another courier cannot change A''s preference (RPC acts on the caller only, direct update 0 rows)';

  -- ===== K5: refused on_delivery, refused without a courier row =====
  update public.couriers set status = 'on_delivery' where id = v_a;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_courier_accepts_cash(true);
    reset role; raise exception 'FAIL 160.K5: changed while on_delivery';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
    if v_msg not like '%în timpul unei livrări%' then raise exception 'FAIL 160.K5: wrong message %', v_msg; end if;
  end;
  if (select accepts_cash from public.couriers where id = v_a) then raise exception 'FAIL 160.K5: on_delivery change landed'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_courier_accepts_cash(false);
    reset role; raise exception 'FAIL 160.K5: a non-courier got a success';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  raise notice 'PASS 160.K5: refused on_delivery (Romanian message) and for a non-courier (%)', v_msg;

  -- ===== K6: grants =====
  if has_function_privilege('anon', 'public.set_courier_accepts_cash(boolean)', 'execute') then raise exception 'FAIL 160.K6: anon can execute'; end if;
  if has_function_privilege('viewer', 'public.set_courier_accepts_cash(boolean)', 'execute') then raise exception 'FAIL 160.K6: viewer can execute'; end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = 'public.set_courier_accepts_cash(boolean)'::regprocedure and a.grantee = 0) then
    raise exception 'FAIL 160.K6: PUBLIC can execute';
  end if;
  if not has_function_privilege('authenticated', 'public.set_courier_accepts_cash(boolean)', 'execute') then raise exception 'FAIL 160.K6: authenticated cannot execute'; end if;
  raise notice 'PASS 160.K6: execute for authenticated only (not anon, viewer, PUBLIC)';
end $$;
