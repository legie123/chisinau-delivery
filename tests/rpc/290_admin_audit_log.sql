-- Every admin intervention leaves a trace (migration 20261012000490_admin_audit_log).
-- A platform_admin (or a service_role server path) that inserts, updates or deletes on an
-- operational table gets one admin_audit_log row: who, what table/row, when, old and new values
-- (UPDATE: only the changed keys). Customers/couriers/partners acting on their own data leave no
-- row. The log is append-only, admin-readable only, and masks personal data (phone, email, IBAN,
-- free text) so an erasure is not undone by its own audit trail.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_admin uuid; v_rest uuid; v_addr uuid; v_oid uuid; v_n int; v_row public.admin_audit_log; v_err text; v_seen int;
  v_before bigint; v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_prest uuid := '11111111-1111-1111-1111-111111111111'; v_item uuid; v_courier uuid;
begin
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select coalesce(max(id), 0) into v_before from public.admin_audit_log;

  -- ===== AU1: admin edits a restaurant -> one row, only the changed key =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.restaurants set delivery_fee_mdl = delivery_fee_mdl + 7 where id = v_rest;
  reset role;
  select * into v_row from public.admin_audit_log where id > v_before and table_name = 'restaurants' order by id desc limit 1;
  if v_row.id is null or v_row.actor is distinct from v_admin or v_row.action <> 'UPDATE' or v_row.row_id <> v_rest::text
     or not (v_row.new_values ? 'delivery_fee_mdl') or (v_row.new_values ? 'name') then
    raise exception 'FAIL 290.AU1: admin restaurant edit not audited as one diff row (%)', row_to_json(v_row);
  end if;
  raise notice 'PASS 290.AU1: admin edit audited (old %, new %)', v_row.old_values, v_row.new_values;

  -- ===== AU2: a partner/customer acting on own data on AUDITED tables leaves no row =====
  select count(*) into v_n from public.admin_audit_log where id > v_before;
  select id into v_item from public.menu_items where restaurant_id = v_prest order by id limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.menu_items set price_mdl = price_mdl + 1 where id = v_item;       -- partner on own menu (audited table)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 290', 47.02, 28.83) returning id into v_addr;
  reset role;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, notes)
  values ('standard', c_cust, v_rest, v_addr, 'pending_restaurant', 'cash', 'unpaid', 200, 30, 230, 'interfon 25, sună la Ana 069111222')
  returning id into v_oid;            -- as postgres: system path, not an admin either
  if (select count(*) from public.admin_audit_log where id > v_before) <> v_n then
    raise exception 'FAIL 290.AU2: non-admin activity was audited';
  end if;
  raise notice 'PASS 290.AU2: customer/system activity leaves no audit row';

  -- ===== AU3: admin cancels through the RPC -> status change audited, free text masked =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.orders set notes = 'admin: clientul a sunat, alt interfon 31' where id = v_oid;
  perform public.cancel_order(v_oid, 'sim 290 anulare de admin');
  reset role;
  select * into v_row from public.admin_audit_log where id > v_before and table_name = 'orders' and row_id = v_oid::text
    and new_values ? 'status' order by id desc limit 1;
  if v_row.id is null or v_row.new_values->>'status' <> 'cancelled' or v_row.old_values->>'status' <> 'pending_restaurant' then
    raise exception 'FAIL 290.AU3: admin cancel not audited with old/new status (%)', row_to_json(v_row);
  end if;
  if exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'orders'
             and (coalesce(old_values->>'notes','') like '%069%' or coalesce(new_values->>'notes','') like '%interfon%')) then
    raise exception 'FAIL 290.AU3: order notes (free text, possible PII) copied into the audit log';
  end if;
  raise notice 'PASS 290.AU3: admin cancel audited (% -> %), notes masked', v_row.old_values->>'status', v_row.new_values->>'status';

  -- ===== AU4: append-only, admin-only =====
  v_err := null;
  begin
    update public.admin_audit_log set actor = null where id = v_row.id;
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL 290.AU4: audit row could be rewritten'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from public.admin_audit_log;
  reset role;
  if v_seen <> 0 then raise exception 'FAIL 290.AU4: a customer reads % audit rows', v_seen; end if;
  raise notice 'PASS 290.AU4: rewrite refused (%), customer sees 0 rows', v_err;

  -- ===== AU5: a service_role Server Action names its admin (x-audit-actor) -> attributed =====
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.headers', json_build_object('x-audit-actor', v_admin)::text, true);
  set local role service_role;
  update public.restaurants set delivery_fee_mdl = delivery_fee_mdl - 7 where id = v_rest;
  reset role;
  select * into v_row from public.admin_audit_log where id > v_before and table_name = 'restaurants' order by id desc limit 1;
  if v_row.actor_role <> 'service_role' or v_row.actor is distinct from v_admin then
    raise exception 'FAIL 290.AU5: service_role action for an admin not attributed to that admin (%)', row_to_json(v_row);
  end if;
  raise notice 'PASS 290.AU5: service_role Server Action attributed to admin %', v_row.actor;

  -- ===== AU6: service_role WITHOUT a named admin (webhook, push) is still recorded, as 'system' =====
  perform set_config('request.headers', '{}', true);
  set local role service_role;
  update public.restaurants set delivery_fee_mdl = delivery_fee_mdl + 1 where id = v_rest;
  reset role;
  select * into v_row from public.admin_audit_log where id > v_before and table_name = 'restaurants' order by id desc limit 1;
  if v_row.actor_role is distinct from 'system' or v_row.actor is not null then
    raise exception 'FAIL 290.AU6: unnamed service_role write not recorded as system (%)', row_to_json(v_row);
  end if;
  raise notice 'PASS 290.AU6: unnamed service_role write recorded as system (fail-closed)';

  -- ===== AU10: a header naming a non-admin is not trusted -> 'system', no actor =====
  perform set_config('request.headers', json_build_object('x-audit-actor', c_cust)::text, true);
  set local role service_role;
  update public.restaurants set delivery_fee_mdl = delivery_fee_mdl - 1 where id = v_rest;
  reset role;
  select * into v_row from public.admin_audit_log where id > v_before and table_name = 'restaurants' order by id desc limit 1;
  if v_row.actor_role is distinct from 'system' or v_row.actor is not null then
    raise exception 'FAIL 290.AU10: header naming a customer was trusted (%)', row_to_json(v_row);
  end if;
  raise notice 'PASS 290.AU10: header naming a non-admin recorded as system, actor null';

  -- ===== AU11: no coordinates through geo, no GPS through fraud_flags.detail =====
  perform set_config('request.headers', json_build_object('x-audit-actor', v_admin)::text, true);
  set local role service_role;
  insert into public.fraud_flags (courier_id, kind, detail)
  select id, 'gps_teleport', jsonb_build_object('from', jsonb_build_object('lat', 47.0123, 'lng', 28.8612), 'to', jsonb_build_object('lat', 46.9988, 'lng', 28.9011))
    from public.couriers order by id limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Geo 290', 47.031122, 28.844455);
  reset role;
  if exists (select 1 from public.admin_audit_log where id > v_before
             and (coalesce(old_values::text,'') || coalesce(new_values::text,'')) ~ '0101000020|47\.0123|46\.9988|47\.031122') then
    raise exception 'FAIL 290.AU11: coordinates copied into the audit log (geo or fraud detail)';
  end if;
  if not exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'fraud_flags' and new_values->>'detail' = '***') then
    raise exception 'FAIL 290.AU11: fraud flag insert not recorded (masked)';
  end if;
  raise notice 'PASS 290.AU11: geo never copied, fraud detail masked';

  -- ===== AU12: the service key cannot erase an impersonation record or forge a timeline event unseen =====
  perform set_config('request.headers', '{}', true);
  set local role service_role;
  insert into public.view_as_sessions (admin_id, target_user_id, target_app, expires_at, reason)
  values (v_admin, c_cust, 'client', now() + interval '10 minutes', 'sim 290 motiv vezi-ca');
  delete from public.view_as_sessions where reason = 'sim 290 motiv vezi-ca';
  insert into public.delivery_status_events (order_id, status, actor_role, note) values (v_oid, 'delivered', 'system', 'sim 290 fals');
  update public.order_items set unit_price_mdl = unit_price_mdl where false;
  reset role;
  if (select count(*) from public.admin_audit_log where id > v_before and table_name = 'view_as_sessions' and actor_role = 'system') < 2
     or not exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'delivery_status_events' and actor_role = 'system') then
    raise exception 'FAIL 290.AU12: service-key impersonation record / timeline forgery left no audit row';
  end if;
  if exists (select 1 from public.admin_audit_log where id > v_before and (coalesce(old_values::text,'') || coalesce(new_values::text,'')) ~ 'sim 290 motiv vezi-ca|sim 290 fals') then
    raise exception 'FAIL 290.AU12: free-text reason/note copied in clear';
  end if;
  raise notice 'PASS 290.AU12: impersonation insert+delete and forged timeline event recorded as system, text masked';

  -- ===== AU7: service_role cannot forge, delete or truncate the log =====
  v_err := null;
  set local role service_role;
  begin
    insert into public.admin_audit_log (actor, actor_role, action, table_name, at) values (v_admin, 'platform_admin', 'UPDATE', 'orders', '2025-01-01');
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null then raise exception 'FAIL 290.AU7: service_role forged an audit row'; end if;
  v_err := null;
  set local role service_role;
  begin
    truncate public.admin_audit_log;
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null then raise exception 'FAIL 290.AU7: service_role truncated the audit log'; end if;
  raise notice 'PASS 290.AU7: service_role forge/truncate refused (%)', v_err;

  -- ===== AU8: erasure run by an admin is audited, without the erased data =====
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.erase_customer_pii(c_cust);
  reset role;
  if not exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'addresses' and row_id = v_addr::text) then
    raise exception 'FAIL 290.AU8: erasure of an address by an admin left no audit row';
  end if;
  if exists (select 1 from public.admin_audit_log where id > v_before
             and (old_values::text like '%Str. Sim 290%' or old_values::text like '%069%' or new_values::text like '%Str. Sim 290%')) then
    raise exception 'FAIL 290.AU8: erased personal data copied into the audit log';
  end if;
  raise notice 'PASS 290.AU8: admin erasure audited, erased values not kept';

  -- ===== AU9: courier name/phone and cash notes are masked =====
  select id into v_courier from public.couriers order by id limit 1;
  set local role authenticated;
  update public.couriers set full_name = 'Ion Sim290 Popescu', phone = '069290290' where id = v_courier;
  perform public.record_cash_offload(v_courier, 1, 'predat de Ion Sim290, tel 069290290');
  reset role;
  if exists (select 1 from public.admin_audit_log where id > v_before
             and (old_values::text || coalesce(new_values::text,'')) ~ 'Sim290|069290290') then
    raise exception 'FAIL 290.AU9: courier personal data or cash note copied into the audit log';
  end if;
  if not exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'couriers' and new_values->>'full_name' = '***') then
    raise exception 'FAIL 290.AU9: courier name change not recorded (masked)';
  end if;
  raise notice 'PASS 290.AU9: courier name/phone and cash note recorded as ***';
end $$;
