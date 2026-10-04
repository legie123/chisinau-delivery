-- Wave 8 master-audit remediation sims. BEGIN/ROLLBACK — nothing persists.

-- ===== M1/M34 (CRITICAL): tip frozen after an online charge is captured =====
do $$
declare v_rest uuid; v_oid uuid; v_intent uuid; v_raised boolean := false; v_total numeric;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest, 'accepted','online_gateway','unpaid', 200, 30, 230, 0)
  returning id into v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  select public.start_online_payment(v_oid) into v_intent;
  -- capture via the gateway webhook (service role) — customer self-confirm is denied (B2)
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  perform public.confirm_online_payment(v_intent, true, 'ref');   -- captured, payment_status=paid
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);

  -- attacker tries to inflate the tip AFTER capture → must raise
  begin
    perform public.set_order_tip(v_oid, 500);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL M1: tip changed after online capture'; end if;
  select total_mdl into v_total from public.orders where id = v_oid;
  if v_total <> 230 then raise exception 'FAIL M1: total inflated to % after capture', v_total; end if;
  raise notice 'PASS M1/M34: tip frozen after online capture (total stays %)', v_total;

  -- cash order stays editable (collected at handover)
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest, 'accepted','cash','unpaid', 200, 30, 230, 0)
  returning id into v_oid;
  perform public.set_order_tip(v_oid, 50);
  select total_mdl into v_total from public.orders where id = v_oid;
  if v_total <> 280 then raise exception 'FAIL M1: cash tip blocked (total %)', v_total; end if;
  raise notice 'PASS M1b: cash tip still editable (total %)', v_total;
end $$;

-- ===== M6/M7 (HIGH): admin can resolve a stuck pending_capture order =====
do $$
declare v_rest uuid; v_oid uuid; v_pay text;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest, 'accepted','online_gateway','pending_capture', 200, 30, 230)
  returning id into v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  perform public.admin_update_payment_status(v_oid, 'paid', 'gateway confirmed out of band');
  select payment_status into v_pay from public.orders where id = v_oid;
  if v_pay <> 'paid' then raise exception 'FAIL M6: pending_capture->paid rejected (%)', v_pay; end if;
  raise notice 'PASS M6/M7: admin resolves stuck pending_capture -> paid (delivery unblocked)';
end $$;

-- ===== M4/M15 (HIGH): overnight hours span covers the post-midnight hour =====
set timezone to 'Europe/Chisinau';
do $$
declare v_rest uuid; v_mon timestamptz; v_fri_1am boolean; v_thu_11pm boolean; v_thu_3am boolean;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  delete from public.restaurant_hours where restaurant_id = v_rest;
  -- open Thursday(4) 22:00 → 02:00 (overnight), closed otherwise
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '22:00'::time, '02:00'::time, (d <> 4) from generate_series(0,6) d;
  v_mon := date_trunc('week', now());  -- Monday 00:00 Europe/Chisinau

  v_fri_1am  := public.restaurant_open_at(v_rest, v_mon + interval '4 day' + interval '1 hour');   -- Fri 01:00 (Thu overnight)
  v_thu_11pm := public.restaurant_open_at(v_rest, v_mon + interval '3 day' + interval '23 hour');  -- Thu 23:00 (evening)
  v_thu_3am  := public.restaurant_open_at(v_rest, v_mon + interval '3 day' + interval '3 hour');   -- Thu 03:00 (closed)

  if not v_fri_1am then raise exception 'FAIL M15: post-midnight overnight hour read CLOSED'; end if;
  if not v_thu_11pm then raise exception 'FAIL M15: evening overnight hour read CLOSED'; end if;
  if v_thu_3am then raise exception 'FAIL M15: 03:00 wrongly read OPEN'; end if;
  raise notice 'PASS M4/M15: overnight span open at 01:00 & 23:00, closed at 03:00';
end $$;

-- ===== M24/M30 (LOW): clawback reverses the ACTUAL settled ledger gross =====
do $$
declare v_rest uuid; v_oid uuid; v_neg numeric;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl, delivered_at)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest, 'delivered','online_gateway','paid', 1000, 0, 1000, 0, now())
  returning id into v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  perform public.admin_generate_payouts((now() at time zone 'Europe/Chisinau')::date, (now() at time zone 'Europe/Chisinau')::date);
  -- now change platform commission, THEN refund → clawback must use the settled gross, not recompute
  update public.platform_settings set restaurant_commission_pct = 50 where id;
  update public.orders set payment_status = 'refunded' where id = v_oid;
  select net_mdl into v_neg from public.payouts where recipient_type='restaurant' and recipient_id=v_rest and net_mdl < 0 order by created_at desc limit 1;
  -- settled gross was 1000 @ 20% → net 800; clawback must be -800 (from ledger), NOT -500 (recompute @50%)
  if v_neg <> -800 then raise exception 'FAIL M24: clawback recomputed from live pct (net % expected -800)', v_neg; end if;
  raise notice 'PASS M24/M30: clawback reverses the actual settled gross (net %)', v_neg;
end $$;

-- ===== M33 (LOW): ILIKE wildcards in the query are treated literally =====
do $$
declare v_all int; v_pct int;
begin
  select count(*) into v_all from public.search_menu_items('roll');
  select count(*) into v_pct from public.search_menu_items('%');   -- would match everything if unescaped
  if v_all = 0 then raise exception 'FAIL M33: baseline search broken'; end if;
  if v_pct > 0 then raise exception 'FAIL M33: bare %% matched % items (wildcard not escaped)', v_pct; end if;
  raise notice 'PASS M33: literal %% matches 0 (escaped), roll matches %', v_all;
end $$;
