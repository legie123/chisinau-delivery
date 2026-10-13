-- 112: the customer can report a problem from the app after the restaurant accepted (parity row 12,
-- migration 20261012000109). Before: once accepted, the app offered nothing — order_complaints could be
-- opened only by ops. customer_report_problem(order, kind, note): the order's own customer, any state
-- after pending_restaurant (pending -> cancel instead), at most one open complaint per order; it lands
-- in ops' complaint log and raises an ops alert at once. The customer reads only their own complaint.
do $$
declare
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_other constant uuid := 'b0000000-0000-0000-0000-000000000001';
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_pending uuid; v_done uuid; v_c uuid; v_n int;
begin
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, 'pending_restaurant', 'cash', 'unpaid', 100, 20, 120) returning id into v_pending;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, 'delivered', 'cash', 'paid', 100, 20, 120) returning id into v_done;

  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  -- 112.1 still pending: refused (cancel instead)
  begin
    perform public.customer_report_problem(v_pending, 'late', 'Întârzie');
    raise exception 'FAIL 112.1: a complaint on a pending order (should cancel instead)';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- 112.2 delivered with a missing item: accepted, in the ops log, alert raised
  v_c := public.customer_report_problem(v_done, 'missing_item', 'Lipsea sosul');
  if not exists (select 1 from public.order_complaints where id = v_c and order_id = v_done and created_by = c_cust and status = 'open') then
    raise exception 'FAIL 112.2: complaint not in the ops log';
  end if;
  if not exists (select 1 from public.ops_alerts where kind = 'customer_complaint' and ref_id = v_c) then
    raise exception 'FAIL 112.2: no ops alert for the customer complaint';
  end if;
  -- 112.3 a second open one on the same order is refused
  begin
    perform public.customer_report_problem(v_done, 'quality', 'Rece');
    raise exception 'FAIL 112.3: a second open complaint';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- 112.4 another customer cannot report on this order
  perform set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
  begin
    perform public.customer_report_problem(v_done, 'late', 'x x x');
    raise exception 'FAIL 112.4: a stranger reported on someone else''s order';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 112.1-4: after acceptance only, own order only, one open, logged + alerted';
end $$;

-- 112.5 the customer reads NO complaint row (since 20261012000111: ops notes/resolutions are internal,
-- sim 113.6 covers my_order_complaint_status); no direct writes
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.order_complaints;
  if v_n <> 0 then raise exception 'FAIL 112.5: the customer reads % complaint rows', v_n; end if;
  begin
    insert into public.order_complaints (order_id, kind, note) select id, 'other', 'direct' from public.orders limit 1;
    raise exception 'FAIL 112.5: direct insert allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 112.5: no complaint rows for the customer, no direct writes';
end $$;
reset role;
