-- SYSTEM SCENARIO 7 (cross-sector, written by ADMIN as the consumer): the admin reassigns, cancels
-- and refunds in the middle of an order. Checks what each app sees afterwards — customer (order
-- row through RLS), old courier (cannot act any more), new courier (can), restaurant (status),
-- the courier fleet state, dispatch offers, the status-event timeline and the admin audit trail.
-- Owners of the behaviour under test: CURIER (admin_reassign_courier, advance_delivery_status),
-- CLIENT/ADMIN (cancel_order), ADMIN (admin_update_payment_status). A red line here is fixed by
-- the owner, never by weakening this file.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_admin uuid; v_rest uuid; v_addr uuid; v_oid uuid; v_err text; v_st text; v_pay text;
  v_a uuid; v_a_user uuid; v_b uuid; v_b_user uuid; v_before bigint;
begin
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  select id into v_rest from public.restaurants where is_active and lat is not null order by name limit 1;
  select coalesce(max(id), 0) into v_before from public.admin_audit_log;
  select id, user_id into v_a, v_a_user from public.couriers where is_active and public.courier_has_capacity(id) order by id limit 1;
  select id, user_id into v_b, v_b_user from public.couriers where is_active and public.courier_has_capacity(id) and id <> v_a order by id limit 1;
  update public.couriers set status = 'online' where id = v_b;
  update public.couriers set status = 'on_delivery' where id = v_a;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sistem 7', 47.02, 28.83)
  returning id into v_addr;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'card_on_delivery', 'unpaid', 200, 30, 230, v_a)
  returning id into v_oid;

  -- ===== 7.1 reassign A -> B =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_reassign_courier(v_oid, v_b);
  reset role;
  if (select courier_id from public.orders where id = v_oid) is distinct from v_b then
    raise exception 'FAIL 291.7.1: order not on the new courier';
  end if;
  -- old courier can no longer move it
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.advance_delivery_status(v_oid, 'picked_up'); exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null then raise exception 'FAIL 291.7.1: the old courier could still advance the reassigned order'; end if;
  -- new courier can
  perform set_config('request.jwt.claims', json_build_object('sub', v_b_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.advance_delivery_status(v_oid, 'picked_up');
  perform public.advance_delivery_status(v_oid, 'en_route');
  reset role;
  if not exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'orders' and row_id = v_oid::text
                 and actor = v_admin and old_values->>'courier_id' = v_a::text and new_values->>'courier_id' = v_b::text) then
    raise exception 'FAIL 291.7.1: reassignment not in the admin audit trail';
  end if;
  raise notice 'PASS 291.7.1: reassigned A->B; A refused (%), B delivered to en_route; audited', v_err;

  -- ===== 7.2 admin cancels while en_route =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.cancel_order(v_oid, 'sim 291: anulare de admin în livrare');
  reset role;
  select status into v_st from public.orders where id = v_oid;
  if v_st <> 'cancelled' then raise exception 'FAIL 291.7.2: order is % after admin cancel', v_st; end if;
  if (select status from public.couriers where id = v_b) <> 'online' then
    raise exception 'FAIL 291.7.2: courier B not released after the cancel';
  end if;
  if exists (select 1 from public.dispatch_offers where order_id = v_oid and status = 'offered') then
    raise exception 'FAIL 291.7.2: a live offer survived the cancel';
  end if;
  -- the customer sees it through RLS
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select status into v_st from public.orders where id = v_oid;
  reset role;
  if v_st is distinct from 'cancelled' then raise exception 'FAIL 291.7.2: customer sees % (want cancelled)', v_st; end if;
  -- courier B can no longer deliver it
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.advance_delivery_status(v_oid, 'delivered', true); exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null then raise exception 'FAIL 291.7.2: a cancelled order could still be delivered'; end if;
  if not exists (select 1 from public.delivery_status_events where order_id = v_oid and status = 'cancelled' and actor_role = 'platform_admin') then
    raise exception 'FAIL 291.7.2: cancel not on the timeline as platform_admin';
  end if;
  if not exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'orders' and row_id = v_oid::text
                 and old_values->>'status' = 'en_route' and new_values->>'status' = 'cancelled') then
    raise exception 'FAIL 291.7.2: cancel not in the admin audit trail';
  end if;
  raise notice 'PASS 291.7.2: cancelled en_route; courier released, no live offer, customer sees cancelled, delivery refused, audited';

  -- ===== 7.3 refund on a delivered, paid order =====
  update public.orders set status = 'delivered', delivered_at = now(), payment_status = 'paid' where id = v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_update_payment_status(v_oid, 'refund_pending', 'sim 291 dispută');
  perform public.admin_update_payment_status(v_oid, 'refunded', 'sim 291 rambursat');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select payment_status into v_pay from public.orders where id = v_oid;
  reset role;
  if v_pay is distinct from 'refunded' then raise exception 'FAIL 291.7.3: customer sees payment %', v_pay; end if;
  if (select count(*) from public.admin_audit_log where id > v_before and table_name = 'orders' and row_id = v_oid::text
      and new_values ? 'payment_status' and actor = v_admin) < 2 then
    raise exception 'FAIL 291.7.3: refund steps not both in the admin audit trail';
  end if;
  raise notice 'PASS 291.7.3: refund paid -> refund_pending -> refunded seen by the customer, both steps audited';
end $$;
