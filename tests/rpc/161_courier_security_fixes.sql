-- Courier security fixes (migration 20261012000213, audit 2026-10-18 #2 #5 #6 #4 #15).
-- L1 #2  the courier cannot DELETE its own courier_locations row (was: DELETE 1, then INSERT anything)
-- L2 #2  a client INSERT with updated_at = now()+10y is stored as now() (was: 2036 -> "live" forever)
-- L3 #2  control: the real heartbeat upsert (web + mobile shape) still works, first insert AND update
-- L4 #5  an inactive courier cannot write courier_locations and sees 0 unassigned orders; active sees it
-- V1 #6  available_orders_for_couriers exists, has no notes/customer_id/idempotency_key/request_fingerprint
-- V2 #6  active courier sees the order through the view; inactive / customer see 0; no write grant; anon none
-- P1 #4  online courier, 0 deliveries, cash over cap: assign_courier + accept_dispatch_offer name the cap
-- P2 #4  control: a courier with a delivery in flight still gets "you already have an active delivery"
-- X1 #15 courier_has_capacity: no EXECUTE for authenticated; a customer call is refused
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_rlat numeric; v_rlng numeric;
  v_a uuid; v_ua uuid; v_i uuid; v_ui uuid; v_o uuid; v_o2 uuid; v_off uuid;
  v_ts timestamptz; n int; v_msg text; v_cols text;
begin
  select id, lat, lng into v_rest, v_rlat, v_rlng from public.restaurants where is_active and lat is not null order by name limit 1;
  select id, user_id into v_a, v_ua from public.couriers where is_active and user_id is not null order by id limit 1;
  select id, user_id into v_i, v_ui from public.couriers where is_active and user_id is not null and id <> v_a order by id limit 1;
  if v_i is null then raise exception 'FAIL 161.setup: need two couriers'; end if;
  update public.couriers set is_active = false where id = v_i;
  -- clean slate for A: nothing in flight, no live offer, zero cash, online
  update public.orders set status = 'cancelled', courier_id = null
    where courier_id in (v_a, v_i) and status in ('courier_assigned', 'picked_up', 'en_route');
  update public.dispatch_offers set status = 'cancelled' where courier_id in (v_a, v_i) and status = 'offered';
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
    select v_a, 'refund_reversal', -public.courier_cash_balance(v_a), 'sim 161 baseline' where public.courier_cash_balance(v_a) > 0;
  update public.couriers set status = 'online' where id = v_a;
  delete from public.courier_locations where courier_id in (v_a, v_i);
  insert into public.courier_locations (courier_id, lat, lng) values (v_a, v_rlat + 0.01, v_rlng);

  -- ===== L1: no DELETE for the courier =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.courier_locations where courier_id = v_a;
  get diagnostics n = row_count;
  reset role;
  if n <> 0 or not exists (select 1 from public.courier_locations where courier_id = v_a) then
    raise exception 'FAIL 161.L1: courier deleted its own location row (% rows)', n;
  end if;
  raise notice 'PASS 161.L1: courier DELETE on courier_locations affects 0 rows';

  -- ===== L2: a forged future updated_at on INSERT is replaced by now() =====
  delete from public.courier_locations where courier_id = v_a;
  set local role authenticated;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
    values (v_a, v_rlat, v_rlng, now() + interval '10 years');
  reset role;
  select updated_at into v_ts from public.courier_locations where courier_id = v_a;
  if v_ts > now() + interval '1 minute' then
    raise exception 'FAIL 161.L2: client chose its own freshness: updated_at=%', v_ts;
  end if;
  raise notice 'PASS 161.L2: forged updated_at (+10y) stored as % (now)', v_ts;

  -- ===== L3: the real heartbeat (PostgREST upsert = INSERT .. ON CONFLICT DO UPDATE) still works =====
  delete from public.courier_locations where courier_id = v_a;
  set local role authenticated;
  insert into public.courier_locations (courier_id, lat, lng, accuracy_m) values (v_a, v_rlat + 0.001, v_rlng, 12)
    on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m;
  insert into public.courier_locations (courier_id, lat, lng) values (v_a, v_rlat + 0.002, v_rlng)
    on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng;
  reset role;
  if (select lat from public.courier_locations where courier_id = v_a) <> v_rlat + 0.002 then
    raise exception 'FAIL 161.L3: heartbeat upsert did not land';
  end if;
  raise notice 'PASS 161.L3: heartbeat upsert accepted (first insert + update)';

  -- ===== L4: inactive courier: no location write, no unassigned feed =====
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, notes)
  values ('standard', c_cust, v_rest, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230,
          'SIM-161 sunati 069000000 interfon 42') returning id into v_o;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ui, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_msg := null;
  begin
    insert into public.courier_locations (courier_id, lat, lng) values (v_i, v_rlat, v_rlng);
  exception when insufficient_privilege then v_msg := sqlerrm;
  end;
  select count(*) into n from public.orders where id = v_o;
  reset role;
  if v_msg is null then raise exception 'FAIL 161.L4: inactive courier wrote courier_locations'; end if;
  if n <> 0 then raise exception 'FAIL 161.L4: inactive courier sees the unassigned order'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.orders where id = v_o;
  reset role;
  if n <> 1 then raise exception 'FAIL 161.L4: control — active courier does not see the unassigned order'; end if;
  raise notice 'PASS 161.L4: inactive courier: location write refused (%), unassigned 0; active sees 1', v_msg;

  -- ===== V1: the view exposes no PII columns =====
  select string_agg(column_name, ',' order by ordinal_position) into v_cols
    from information_schema.columns where table_schema = 'public' and table_name = 'available_orders_for_couriers';
  if v_cols is null then raise exception 'FAIL 161.V1: view available_orders_for_couriers missing'; end if;
  if v_cols ~ '(^|,)(notes|customer_id|idempotency_key|request_fingerprint|courier_id)(,|$)' then
    raise exception 'FAIL 161.V1: view exposes PII: %', v_cols;
  end if;
  raise notice 'PASS 161.V1: view columns = %', v_cols;

  -- ===== V2: who sees what through the view =====
  set local role authenticated;
  execute 'select count(*) from public.available_orders_for_couriers where id = $1' into n using v_o;
  reset role;
  if n <> 1 then raise exception 'FAIL 161.V2: active courier does not see the order in the view'; end if;
  -- view-as without a live session: the view runs with owner rights, so it must re-check the session itself
  set local role viewer;
  execute 'select count(*) from public.available_orders_for_couriers' into n;
  reset role;
  if n <> 0 then raise exception 'FAIL 161.V2: viewer without a live session sees % rows in the view', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ui, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select count(*) from public.available_orders_for_couriers' into n;
  reset role;
  if n <> 0 then raise exception 'FAIL 161.V2: inactive courier sees % rows in the view', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select count(*) from public.available_orders_for_couriers' into n;
  reset role;
  if n <> 0 then raise exception 'FAIL 161.V2: customer sees % rows in the view', n; end if;
  if has_table_privilege('anon', 'public.available_orders_for_couriers', 'select')
     or has_table_privilege('authenticated', 'public.available_orders_for_couriers', 'insert')
     or has_table_privilege('authenticated', 'public.available_orders_for_couriers', 'update')
     or has_table_privilege('authenticated', 'public.available_orders_for_couriers', 'delete') then
    raise exception 'FAIL 161.V2: view grants too wide';
  end if;
  raise notice 'PASS 161.V2: view: active courier 1, viewer w/o session 0, inactive 0, customer 0; anon no select; authenticated read-only';

  -- ===== P1: cash cap reported as the cap, not as a delivery in flight =====
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note) values (v_a, 'collected', 800, 'sim 161');
  insert into public.cash_policy (cap_mdl, reactivation_threshold_mdl, offload_channel_text, new_courier_cap_mdl, effective_from)
    values (700, 500, 'sim 161', 700, now());
  if public.courier_has_capacity(v_a) or (select status from public.couriers where id = v_a) <> 'online' then
    raise exception 'FAIL 161.P1.setup: A must be online and at the cash cap';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  v_msg := null;
  begin perform public.assign_courier(v_o);
  exception when raise_exception then v_msg := sqlerrm;
  end;
  if v_msg is null or v_msg not like 'Plafon numerar atins%' then
    raise exception 'FAIL 161.P1: assign_courier at cash cap says: %', coalesce(v_msg, '<no error>');
  end if;
  insert into public.dispatch_offers (order_id, courier_id, score, expires_at) values (v_o, v_a, 1, now() + interval '30 seconds')
    returning id into v_off;
  v_msg := null;
  begin perform public.accept_dispatch_offer(v_off);
  exception when raise_exception then v_msg := sqlerrm;
  end;
  if v_msg is null or v_msg not like 'Plafon numerar atins%' then
    raise exception 'FAIL 161.P1: accept_dispatch_offer at cash cap says: %', coalesce(v_msg, '<no error>');
  end if;
  raise notice 'PASS 161.P1: both RPCs at the cash cap: %', v_msg;

  -- ===== P2: control — a delivery in flight keeps the old message =====
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, 'courier_assigned', 'card_on_delivery', 'unpaid', 200, 30, 230, v_a) returning id into v_o2;
  v_msg := null;
  begin perform public.assign_courier(v_o);
  exception when raise_exception then v_msg := sqlerrm;
  end;
  if v_msg is distinct from 'you already have an active delivery' then
    raise exception 'FAIL 161.P2: in-flight courier got: %', coalesce(v_msg, '<no error>');
  end if;
  raise notice 'PASS 161.P2: delivery in flight still -> %', v_msg;

  -- ===== X1: courier_has_capacity is not callable by clients =====
  if has_function_privilege('authenticated', 'public.courier_has_capacity(uuid)', 'execute')
     or has_function_privilege('anon', 'public.courier_has_capacity(uuid)', 'execute') then
    raise exception 'FAIL 161.X1: authenticated/anon can EXECUTE courier_has_capacity';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_msg := null;
  begin perform public.courier_has_capacity(v_a);
  exception when insufficient_privilege then v_msg := sqlerrm;
  end;
  reset role;
  if v_msg is null then raise exception 'FAIL 161.X1: customer probed courier_has_capacity'; end if;
  raise notice 'PASS 161.X1: customer probe refused (%)', v_msg;
end $$;
