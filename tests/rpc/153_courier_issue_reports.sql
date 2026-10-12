-- Courier issue reports (migration 20261012000205_courier_issue_reports).
-- Only the active courier assigned to an ACTIVE order may report; the kind must fit the leg
-- (restaurant problems before pickup, customer problems after); one row per (order, kind); the courier
-- reads only their own reports, platform_admin reads all, customers/other couriers read nothing, nobody
-- writes the table directly.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_rest uuid; v_addr uuid; v_a uuid; v_ua uuid; v_b uuid; v_ub uuid; v_o uuid; v_o_done uuid;
  v_new boolean; n int; v_msg text; v_status text; v_o2 uuid; v_o3 uuid; v_o4 uuid;
begin
  select id into v_rest from public.restaurants where is_active and lat is not null order by name limit 1;
  insert into public.addresses (customer_id, street_address) values (c_cust, 'Str. Sim 153') returning id into v_addr;
  select id, user_id into v_a, v_ua from public.couriers where is_active order by id limit 1;
  select id, user_id into v_b, v_ub from public.couriers where is_active and id <> v_a order by id limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'cash', 'unpaid', 200, 30, 230, v_a) returning id into v_o;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, delivered_at)
  values ('standard', c_cust, v_rest, v_addr, 'delivered', 'cash', 'paid', 200, 30, 230, v_a, now()) returning id into v_o_done;

  -- ===== I1: the assigned courier reports before pickup; the order status is recorded =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_new := public.courier_report_issue(v_o, 'restaurant_delayed');
  reset role;
  select count(*), max(order_status) into n, v_status from public.delivery_issue_reports where order_id = v_o and kind = 'restaurant_delayed' and courier_id = v_a;
  if v_new is distinct from true or n <> 1 or v_status <> 'courier_assigned' then
    raise exception 'FAIL 153.I1: new=% rows=% status=%', v_new, n, v_status;
  end if;
  raise notice 'PASS 153.I1: assigned courier reported restaurant_delayed at courier_assigned';

  -- ===== I2: the same report again is idempotent (no duplicate, returns false) =====
  set local role authenticated;
  v_new := public.courier_report_issue(v_o, 'restaurant_delayed');
  reset role;
  select count(*) into n from public.delivery_issue_reports where order_id = v_o and kind = 'restaurant_delayed';
  if v_new is distinct from false or n <> 1 then raise exception 'FAIL 153.I2: repeat gave new=% rows=%', v_new, n; end if;
  raise notice 'PASS 153.I2: repeat report -> false, still 1 row';

  -- ===== I3: the kind must fit the leg =====
  set local role authenticated;
  begin
    perform public.courier_report_issue(v_o, 'customer_unreachable');
    reset role; raise exception 'FAIL 153.I3: customer problem accepted before pickup';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  update public.orders set status = 'en_route' where id = v_o;
  set local role authenticated;
  begin
    perform public.courier_report_issue(v_o, 'venue_not_found');
    reset role; raise exception 'FAIL 153.I3: restaurant problem accepted after pickup';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  set local role authenticated;
  v_new := public.courier_report_issue(v_o, 'customer_unreachable');
  v_new := v_new and public.courier_report_issue(v_o, 'running_late');
  reset role;
  if not v_new then raise exception 'FAIL 153.I3: customer_unreachable / running_late refused en_route'; end if;
  raise notice 'PASS 153.I3: restaurant kinds only before pickup, customer kinds only after, running_late on both';

  -- ===== I4: unknown kind, finished order, inactive courier are refused =====
  set local role authenticated;
  begin
    perform public.courier_report_issue(v_o, 'bored');
    reset role; raise exception 'FAIL 153.I4: unknown kind accepted';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  set local role authenticated;
  begin
    perform public.courier_report_issue(v_o_done, 'running_late');
    reset role; raise exception 'FAIL 153.I4: report on a delivered order accepted';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  update public.couriers set is_active = false where id = v_a;
  set local role authenticated;
  begin
    perform public.courier_report_issue(v_o, 'address_wrong');
    reset role; raise exception 'FAIL 153.I4: inactive courier accepted';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  update public.couriers set is_active = true where id = v_a;
  raise notice 'PASS 153.I4: unknown kind, delivered order and inactive courier refused';

  -- ===== I5: another courier and the customer cannot report on this order; anon cannot call =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.courier_report_issue(v_o, 'address_wrong');
    reset role; raise exception 'FAIL 153.I5: another courier reported on a foreign order';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.courier_report_issue(v_o, 'address_wrong');
    reset role; raise exception 'FAIL 153.I5: the customer reported as a courier';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform public.courier_report_issue(v_o, 'address_wrong');
    reset role; raise exception 'FAIL 153.I5: anon executed courier_report_issue';
  exception when insufficient_privilege then reset role;
  end;
  raise notice 'PASS 153.I5: other courier, customer and anon refused';

  -- ===== I6: reads — own courier 3 rows, other courier 0, customer 0, admin 3 =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.delivery_issue_reports where order_id = v_o;
  reset role;
  if n <> 3 then raise exception 'FAIL 153.I6: owning courier sees % rows (expected 3)', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.delivery_issue_reports where order_id = v_o;
  reset role;
  if n <> 0 then raise exception 'FAIL 153.I6: another courier sees % rows', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.delivery_issue_reports where order_id = v_o;
  reset role;
  if n <> 0 then raise exception 'FAIL 153.I6: the customer sees % rows', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.delivery_issue_reports where order_id = v_o;
  reset role;
  if n <> 3 then raise exception 'FAIL 153.I6: admin sees % rows (expected 3)', n; end if;
  raise notice 'PASS 153.I6: courier own 3, other courier 0, customer 0, admin 3';

  -- ===== I7: nobody writes the table directly, not even the owning courier =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.delivery_issue_reports (order_id, courier_id, kind, order_status) values (v_o, v_a, 'address_wrong', 'en_route');
    reset role; raise exception 'FAIL 153.I7: courier inserted directly';
  exception when insufficient_privilege then reset role;
  end;
  set local role authenticated;
  begin
    delete from public.delivery_issue_reports where order_id = v_o;
    reset role; raise exception 'FAIL 153.I7: courier deleted directly';
  exception when insufficient_privilege then reset role;
  end;
  raise notice 'PASS 153.I7: direct insert and delete denied';

  -- ===== I9: after a reassignment the NEW courier's report of the same kind is recorded (not swallowed) =====
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'cash', 'unpaid', 200, 30, 230, v_a) returning id into v_o2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_new := public.courier_report_issue(v_o2, 'restaurant_delayed');
  reset role;
  update public.orders set courier_id = v_b where id = v_o2;   -- what admin_reassign_courier does to the row
  perform set_config('request.jwt.claims', json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_new := public.courier_report_issue(v_o2, 'restaurant_delayed');
  select count(*) into n from public.delivery_issue_reports where order_id = v_o2;  -- B sees only its own
  reset role;
  if v_new is distinct from true or n <> 1 then raise exception 'FAIL 153.I9: new courier report new=% visible=%', v_new, n; end if;
  select count(*) into n from public.delivery_issue_reports where order_id = v_o2;
  if n <> 2 then raise exception 'FAIL 153.I9: expected 2 rows (one per courier), got %', n; end if;
  raise notice 'PASS 153.I9: after reassignment the new courier''s report is recorded';

  -- ===== I10: the same kind on the second leg is a new report; picked_up counts as an active status =====
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'cash', 'unpaid', 200, 30, 230, v_a) returning id into v_o3;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_new := public.courier_report_issue(v_o3, 'running_late');
  reset role;
  update public.orders set status = 'picked_up' where id = v_o3;
  set local role authenticated;
  v_new := v_new and public.courier_report_issue(v_o3, 'running_late');
  v_new := v_new and public.courier_report_issue(v_o3, 'customer_unreachable');
  reset role;
  select count(*) into n from public.delivery_issue_reports where order_id = v_o3;
  if not v_new or n <> 3 then raise exception 'FAIL 153.I10: legs new=% rows=% (expected pickup+delivery running_late + customer_unreachable at picked_up)', v_new, n; end if;
  select count(*) into n from public.delivery_issue_reports where order_id = v_o3 and kind = 'running_late' and leg = 'delivery' and order_status = 'picked_up';
  if n <> 1 then raise exception 'FAIL 153.I10: delivery-leg running_late not recorded with its own status'; end if;
  set local role authenticated;
  begin
    perform public.courier_report_issue(v_o3, 'venue_not_found');
    reset role; raise exception 'FAIL 153.I10: restaurant kind accepted at picked_up';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  raise notice 'PASS 153.I10: second leg recorded separately; picked_up active; restaurant kinds refused there';

  -- ===== I11: a cancelled order is refused =====
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'cancelled', 'cash', 'unpaid', 200, 30, 230, v_a) returning id into v_o4;
  set local role authenticated;
  begin
    perform public.courier_report_issue(v_o4, 'running_late');
    reset role; raise exception 'FAIL 153.I11: report on a cancelled order accepted';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text; reset role;
    if v_msg like 'FAIL%' then raise exception '%', v_msg; end if;
  end;
  raise notice 'PASS 153.I11: cancelled order refused';

  -- ===== I12: append-only — the owning courier cannot UPDATE its own report =====
  set local role authenticated;
  begin
    update public.delivery_issue_reports set created_at = created_at - interval '1 hour' where order_id = v_o3;
    reset role; raise exception 'FAIL 153.I12: courier updated a report';
  exception when insufficient_privilege then reset role;
  end;
  raise notice 'PASS 153.I12: UPDATE denied';

  -- ===== I13: a restaurant partner reads no reports, not even for its own restaurant's orders =====
  perform set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.delivery_issue_reports;
  reset role;
  if n <> 0 then raise exception 'FAIL 153.I13: restaurant partner reads % reports', n; end if;
  raise notice 'PASS 153.I13: restaurant partner reads 0 reports';

  -- ===== I8: the ROLLBACK written in the migration works =====
  drop function public.courier_report_issue(uuid, text);
  drop table public.delivery_issue_reports;
  if exists (select 1 from pg_class where relname = 'delivery_issue_reports') or exists (select 1 from pg_proc where proname = 'courier_report_issue') then
    raise exception 'FAIL 153.I8: rollback left objects behind';
  end if;
  raise notice 'PASS 153.I8: rollback drops the function and the table';
end $$;
