-- Partial refunds (migration 20261012000495_admin_partial_refund). admin_refund_order: admin only,
-- reason >= 5 chars, 0 < amount <= total - refunded, online_gateway only (cash is corrected in the
-- cash ledger), running refunded_mdl, 'refunded' only when the total is reached, reason in
-- admin_audit_log as _motiv. Admin cancellation paths (expire_stale_orders sweeper, cancel_order by
-- a platform_admin) move a captured online payment to refund_pending. Runner wraps in BEGIN/ROLLBACK.
do $$
declare
  v_admin uuid; v_cust uuid := 'a0000000-0000-0000-0000-000000000001'; v_rest uuid;
  v_online uuid; v_cash uuid; v_stale uuid; v_stale_cash uuid; v_adm uuid; v_adm_cash uuid;
  v_err text; v_before bigint; v_o public.orders%rowtype;
begin
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  select id into v_rest from public.restaurants where is_active limit 1;
  select coalesce(max(id), 0) into v_before from public.admin_audit_log;

  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, delivered_at)
  values ('standard', v_cust, v_rest, 'delivered', 'online_gateway', 'paid', 250, 50, 300, now()) returning id into v_online;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, delivered_at)
  values ('standard', v_cust, v_rest, 'delivered', 'cash', 'paid', 80, 20, 100, now()) returning id into v_cash;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', v_cust, v_rest, 'pending_restaurant', 'online_gateway', 'paid', 180, 20, 200, now() - interval '3 hours') returning id into v_stale;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', v_cust, v_rest, 'pending_restaurant', 'cash', 'unpaid', 180, 20, 200, now() - interval '3 hours') returning id into v_stale_cash;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_cust, v_rest, 'accepted', 'online_gateway', 'paid', 130, 20, 150) returning id into v_adm;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_cust, v_rest, 'accepted', 'cash', 'unpaid', 130, 20, 150) returning id into v_adm_cash;

  -- ===== R1: amount above what is left / not positive -> refused =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_err := null; begin perform public.admin_refund_order(v_online, 300.01, 'sim 297: peste total'); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like '%între 0 și 300.00 MDL%' then reset role; raise exception 'FAIL 297.R1: refund above total accepted (err=%)', v_err; end if;
  v_err := null; begin perform public.admin_refund_order(v_online, 0, 'sim 297: suma zero'); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like '%între 0 și 300.00 MDL%' then reset role; raise exception 'FAIL 297.R1b: zero refund accepted (err=%)', v_err; end if;
  raise notice 'PASS 297.R1: refund above total / zero refused';

  -- ===== R2: short reason -> refused =====
  v_err := null; begin perform public.admin_refund_order(v_online, 10, 'abc'); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like '%minim 5 caractere%' then reset role; raise exception 'FAIL 297.R2: short reason accepted (err=%)', v_err; end if;
  raise notice 'PASS 297.R2: short reason refused';

  -- ===== R4: cash order -> refused (cash is corrected in the ledger) =====
  v_err := null; begin perform public.admin_refund_order(v_cash, 10, 'sim 297: numerar'); exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like '%registrul de cash%' then reset role; raise exception 'FAIL 297.R4: cash refund accepted (err=%)', v_err; end if;
  raise notice 'PASS 297.R4: cash order refused';
  reset role;

  -- ===== R3: non-admin caller -> refused =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_err := null; begin perform public.admin_refund_order(v_online, 10, 'sim 297: client'); exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null or v_err not like '%administrator%' then raise exception 'FAIL 297.R3: non-admin refund accepted (err=%)', v_err; end if;
  if (select refunded_mdl from public.orders where id = v_online) <> 0 then raise exception 'FAIL 297.R3: refunded_mdl moved on a refused call'; end if;
  raise notice 'PASS 297.R3: non-admin refused';

  -- ===== R5: partial refund -> refund_pending + refunded_mdl + audit with reason + event =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_refund_order(v_online, 100, 'sim 297: sushi lipsă');
  reset role;
  select * into v_o from public.orders where id = v_online;
  if v_o.payment_status <> 'refund_pending' or v_o.refunded_mdl <> 100 then
    raise exception 'FAIL 297.R5: partial refund -> % / refunded_mdl %', v_o.payment_status, v_o.refunded_mdl;
  end if;
  if not exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'orders' and row_id = v_online::text
                 and actor = v_admin and action = 'UPDATE' and (new_values->>'refunded_mdl')::numeric = 100
                 and new_values->>'_motiv' = 'sim 297: sushi lipsă') then
    raise exception 'FAIL 297.R5: refund not audited with its reason';
  end if;
  if not exists (select 1 from public.delivery_status_events where order_id = v_online and actor_role = 'platform_admin'
                 and actor_id = v_admin and note = 'refund: 100.00 MDL (100.00/300.00) — sim 297: sushi lipsă') then
    raise exception 'FAIL 297.R5: no refund event on the order';
  end if;
  raise notice 'PASS 297.R5: partial refund -> refund_pending, refunded_mdl=100, audited with reason';

  -- ===== R6: second refund up to the total -> refunded; nothing more afterwards =====
  set local role authenticated;
  perform public.admin_refund_order(v_online, 200, 'sim 297: restul');
  v_err := null; begin perform public.admin_refund_order(v_online, 1, 'sim 297: după refunded'); exception when others then v_err := sqlerrm; end;
  reset role;
  select * into v_o from public.orders where id = v_online;
  if v_o.payment_status <> 'refunded' or v_o.refunded_mdl <> 300 then
    raise exception 'FAIL 297.R6: full refund -> % / refunded_mdl %', v_o.payment_status, v_o.refunded_mdl;
  end if;
  if v_err is null or v_err not like '%stare: refunded%' then raise exception 'FAIL 297.R6: refund on a refunded order accepted (err=%)', v_err; end if;
  raise notice 'PASS 297.R6: refund to the total -> refunded, further refund refused';

  -- ===== R7: sweeper auto-cancel moves a captured online payment to refund_pending =====
  perform public.expire_stale_orders();
  select * into v_o from public.orders where id = v_stale;
  if v_o.status <> 'cancelled' or v_o.payment_status <> 'refund_pending' then
    raise exception 'FAIL 297.R7: stale paid online order -> % / %', v_o.status, v_o.payment_status;
  end if;
  select * into v_o from public.orders where id = v_stale_cash;
  if v_o.status <> 'cancelled' or v_o.payment_status <> 'unpaid' then
    raise exception 'FAIL 297.R7: stale cash order -> % / % (control)', v_o.status, v_o.payment_status;
  end if;
  raise notice 'PASS 297.R7: expire_stale_orders -> refund_pending for paid online, cash untouched';

  -- ===== R8: admin cancel_order moves a captured online payment to refund_pending =====
  set local role authenticated;
  perform public.cancel_order(v_adm, 'sim 297: anulare admin');
  perform public.cancel_order(v_adm_cash, 'sim 297: anulare admin cash');
  reset role;
  select * into v_o from public.orders where id = v_adm;
  if v_o.status <> 'cancelled' or v_o.payment_status <> 'refund_pending' then
    raise exception 'FAIL 297.R8: admin cancel of paid online order -> % / %', v_o.status, v_o.payment_status;
  end if;
  select * into v_o from public.orders where id = v_adm_cash;
  if v_o.status <> 'cancelled' or v_o.payment_status <> 'unpaid' then
    raise exception 'FAIL 297.R8: admin cancel of cash order -> % / % (control)', v_o.status, v_o.payment_status;
  end if;
  raise notice 'PASS 297.R8: admin cancel_order -> refund_pending for paid online, cash untouched';

  -- ===== R9: grants — authenticated yes, anon no =====
  if has_function_privilege('anon', 'public.admin_refund_order(uuid, numeric, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_refund_order(uuid, numeric, text)', 'execute') then
    raise exception 'FAIL 297.R9: admin_refund_order grants (anon must not execute, authenticated must)';
  end if;
  raise notice 'PASS 297.R9: grants';
end $$;
