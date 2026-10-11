-- 255: ops alerts with a mechanism (W5, migration 20261012000407). scan_ops_alerts() (pg_cron, every
-- minute) raises one alert per (kind, ref) for: an order the restaurant has not accepted within
-- platform_settings.restaurant_accept_alert_minutes (ops phones the restaurant BEFORE the SLA cancels
-- it), a dispatch_errors row, a push stuck in notification_outbox. Re-scans never duplicate. With
-- app.ops_alert_webhook_url set, each new alert is POSTed once via pg_net. Admin-only read + ack.
do $$
declare
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid;
  v_late uuid;
  v_fresh uuid;
  v_ready uuid;
  v_push uuid;
  v_n int;
  v_alert uuid;
  v_req_before bigint;
  v_req_after bigint;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', c_cust, v_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 20, 220, now() - interval '4 minutes')
  returning id into v_late;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', c_cust, v_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 20, 220, now() - interval '1 minute')
  returning id into v_fresh;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, 'ready_for_pickup', 'cash', 'unpaid', 200, 20, 220)
  returning id into v_ready;
  insert into public.dispatch_errors (order_id, error_code, phase, message) values (v_ready, 'P0001', 'sweep', 'sim 255');
  insert into public.notification_outbox (user_id, title, created_at) values (c_cust, 'sim 255', now() - interval '10 minutes')
  returning id into v_push;

  -- 255.1 the three kinds are raised; the 1-minute order is not
  perform public.scan_ops_alerts();
  if not exists (select 1 from public.ops_alerts where kind = 'restaurant_not_accepting' and ref_id = v_late) then
    raise exception 'FAIL 255.1: no alert for an order unaccepted for 4 min';
  end if;
  if exists (select 1 from public.ops_alerts where ref_id = v_fresh) then
    raise exception 'FAIL 255.1: alert for an order placed 1 min ago';
  end if;
  if not exists (select 1 from public.ops_alerts where kind = 'dispatch_error' and ref_id = v_ready) then
    raise exception 'FAIL 255.1: no alert for a dispatch error';
  end if;
  if not exists (select 1 from public.ops_alerts where kind = 'push_stuck' and ref_id = v_push) then
    raise exception 'FAIL 255.1: no alert for a push stuck 10 min';
  end if;
  raise notice 'PASS 255.1: unaccepted order, dispatch error and stuck push each raise an alert';

  -- 255.2 a rescan never duplicates
  select count(*) into v_n from public.ops_alerts where ref_id in (v_late, v_ready, v_push);
  perform public.scan_ops_alerts();
  if (select count(*) from public.ops_alerts where ref_id in (v_late, v_ready, v_push)) <> v_n then
    raise exception 'FAIL 255.2: rescan duplicated alerts';
  end if;
  raise notice 'PASS 255.2: rescan is idempotent';

  -- 255.3 webhook: each un-notified alert is POSTed once, then marked notified
  perform set_config('app.ops_alert_webhook_url', 'http://127.0.0.1:9/sim255', true);
  select coalesce(max(id), 0) into v_req_before from net.http_request_queue;
  perform public.scan_ops_alerts();
  select count(*) into v_req_after from net.http_request_queue where id > v_req_before and url = 'http://127.0.0.1:9/sim255';
  if v_req_after < 3 then raise exception 'FAIL 255.3: % webhook requests queued, expected >= 3', v_req_after; end if;
  if exists (select 1 from public.ops_alerts where ref_id in (v_late, v_ready, v_push) and notified_at is null) then
    raise exception 'FAIL 255.3: alerts not marked notified';
  end if;
  select count(*) into v_req_before from net.http_request_queue where url = 'http://127.0.0.1:9/sim255';
  perform public.scan_ops_alerts();
  if (select count(*) from net.http_request_queue where url = 'http://127.0.0.1:9/sim255') <> v_req_before then
    raise exception 'FAIL 255.3: notified alerts were POSTed again';
  end if;
  raise notice 'PASS 255.3: webhook posts each alert once';

  -- 255.4 admin acks; a customer cannot
  select id into v_alert from public.ops_alerts where ref_id = v_late;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_ack_ops_alert(v_alert);
    raise exception 'FAIL 255.4: a customer acked an alert';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  perform public.admin_ack_ops_alert(v_alert);
  if (select acked_by from public.ops_alerts where id = v_alert) is distinct from c_admin then
    raise exception 'FAIL 255.4: ack not recorded';
  end if;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 255.4: admin acks, customer refused';
end $$;

-- 255.5 RLS + grants
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.ops_alerts) then raise exception 'FAIL 255.5: a customer reads ops alerts'; end if;
  begin
    perform public.scan_ops_alerts();
    raise exception 'FAIL 255.5: authenticated ran scan_ops_alerts';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
  if not exists (select 1 from public.ops_alerts) then raise exception 'FAIL 255.5: admin cannot read alerts'; end if;
  raise notice 'PASS 255.5: admin-only read; scan not callable by users';
end $$;
reset role;
do $$
begin
  if has_table_privilege('anon', 'public.ops_alerts', 'select')
     or has_function_privilege('anon', 'public.admin_ack_ops_alert(uuid)', 'execute') then
    raise exception 'FAIL 255.6: anon has access';
  end if;
  if not exists (select 1 from cron.job where jobname = 'scan-ops-alerts') then
    raise exception 'FAIL 255.6: scan-ops-alerts is not scheduled';
  end if;
  raise notice 'PASS 255.6: anon locked out; job scheduled';
end $$;
