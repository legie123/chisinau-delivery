-- Money-integrity verification sims. Run wrapped in BEGIN; ... ROLLBACK; nothing persists.
\set CUST '''a0000000-0000-0000-0000-000000000001'''
\set ADMIN '''a0000000-0000-0000-0000-000000000004'''
\set COURIER '''c9a68659-0734-413e-95d0-87cd21f4a0f7'''
\set COURIERUSER '''a0000000-0000-0000-0000-000000000002'''

-- ============ S1/S3: set_order_tip preserves a confirmed CATERING quoted total ============
do $$
declare v_rest uuid; v_oid uuid; v_total numeric; v_tip numeric;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl)
  values ('catering', 'a0000000-0000-0000-0000-000000000001', v_rest, 'accepted', 'cash', 'unpaid',
          200, 0, 5000, 0)   -- quoted_total 5000 stamped onto total by confirm_catering_quote; subtotal is the tiny menu base
  returning id into v_oid;
  insert into public.catering_details (order_id, event_date, guest_count, event_address_text, contact_person, contact_phone, quote_status, quoted_total_mdl)
  values (v_oid, current_date + 7, 50, 'Str. Test 1', 'Ion', '+37360000000', 'confirmed', 5000);

  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  perform public.set_order_tip(v_oid, 100);

  select total_mdl, tip_mdl into v_total, v_tip from public.orders where id = v_oid;
  if v_total <> 5100 then raise exception 'FAIL S3: catering total destroyed -> got % (expected 5100)', v_total; end if;
  if v_tip <> 100 then raise exception 'FAIL S3: tip -> got %', v_tip; end if;
  raise notice 'PASS S3: catering tip preserves quoted total (total=% tip=%)', v_total, v_tip;
end $$;

-- ============ S3b: standard tip uses DELTA (second tip does not stack on the first) ============
do $$
declare v_rest uuid; v_oid uuid; v_total numeric;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest, 'accepted','cash','unpaid', 200, 20, 220, 0)
  returning id into v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  perform public.set_order_tip(v_oid, 30);
  perform public.set_order_tip(v_oid, 10);   -- change mind: should REPLACE, not add
  select total_mdl into v_total from public.orders where id = v_oid;
  if v_total <> 230 then raise exception 'FAIL S3b: tip delta wrong -> total % (expected 230)', v_total; end if;
  raise notice 'PASS S3b: standard tip delta correct (total=%)', v_total;
end $$;

-- ============ S4: online payment intent = total incl. tip exactly ONCE; pending intent re-syncs ============
do $$
declare v_rest uuid; v_oid uuid; v_intent uuid; v_amt numeric;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest, 'pending_restaurant','online_gateway','unpaid', 200, 20, 220, 0)
  returning id into v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  -- open intent first (amount 220), then tip -> intent must re-sync to 250, not 220 and not 280
  select public.start_online_payment(v_oid) into v_intent;
  perform public.set_order_tip(v_oid, 30);
  select amount_mdl into v_amt from public.payment_intents where id = v_intent;
  if v_amt <> 250 then raise exception 'FAIL S4: intent amount % (expected 250, tip re-synced once)', v_amt; end if;
  raise notice 'PASS S4: online intent captures tip exactly once (amount=%)', v_amt;
end $$;

-- ============ S_GATE: online order cannot be DELIVERED unpaid; can once paid (+delivered_at stamp) ============
do $$
declare v_rest uuid; v_oid uuid; v_raised boolean := false; v_dat timestamptz;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl, courier_id)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest, 'en_route','online_gateway','pending_capture', 200, 20, 220, 0,
          'c9a68659-0734-413e-95d0-87cd21f4a0f7')
  returning id into v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000002','role','authenticated')::text, true);
  begin
    perform public.advance_delivery_status(v_oid, 'delivered', true);
  exception when others then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL S_GATE: unpaid online order was delivered!'; end if;

  -- now mark paid, deliver should succeed and stamp delivered_at
  update public.orders set payment_status = 'paid' where id = v_oid;
  perform public.advance_delivery_status(v_oid, 'delivered', true);
  select delivered_at into v_dat from public.orders where id = v_oid;
  if v_dat is null then raise exception 'FAIL S_GATE: delivered_at not stamped'; end if;
  raise notice 'PASS S_GATE: unpaid online delivery blocked; paid delivery stamps delivered_at=%', v_dat;
end $$;

-- ============ S_PAYOUT: catering delivered+paid pays the RESTAURANT; keyed off delivered_at; ledger blocks double ============
do $$
declare v_rest uuid; v_oid uuid; v_gross numeric; v_cnt int; v_gross2 numeric;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl, delivered_at, created_at)
  values ('catering','a0000000-0000-0000-0000-000000000001', v_rest, 'delivered','online_gateway','paid',
          200, 0, 5000, 0, now(), now() - interval '20 days')  -- created weeks ago, delivered today
  returning id into v_oid;

  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  perform public.admin_generate_payouts((now() at time zone 'Europe/Chisinau')::date, (now() at time zone 'Europe/Chisinau')::date);

  select gross_mdl, orders_count into v_gross, v_cnt from public.payouts
   where recipient_type='restaurant' and recipient_id=v_rest and period_start=(now() at time zone 'Europe/Chisinau')::date;
  if v_gross is null or v_gross < 5000 then raise exception 'FAIL S_PAYOUT: restaurant catering gross % (expected >=5000)', v_gross; end if;

  -- re-run same period: ledger must prevent a second settlement (gross unchanged)
  perform public.admin_generate_payouts((now() at time zone 'Europe/Chisinau')::date, (now() at time zone 'Europe/Chisinau')::date);
  select gross_mdl into v_gross2 from public.payouts
   where recipient_type='restaurant' and recipient_id=v_rest and period_start=(now() at time zone 'Europe/Chisinau')::date;
  if v_gross2 <> v_gross then raise exception 'FAIL S_PAYOUT: re-run double-paid (% -> %)', v_gross, v_gross2; end if;
  raise notice 'PASS S_PAYOUT: restaurant paid for catering (gross=%), re-run idempotent', v_gross;
end $$;

-- ============ S_UNPAID_EXCLUDE: delivered-but-unpaid (cash not collected) excluded from payout + surfaced in queue ============
do $$
declare v_rest uuid; v_oid uuid; v_inpayout int; v_inqueue int;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl, delivered_at, courier_id)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest, 'delivered','cash','unpaid',
          200, 20, 220, 0, now(), 'c9a68659-0734-413e-95d0-87cd21f4a0f7')
  returning id into v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  perform public.admin_generate_payouts((now() at time zone 'Europe/Chisinau')::date, (now() at time zone 'Europe/Chisinau')::date);
  select count(*) into v_inpayout from public.payout_orders where order_id = v_oid;
  if v_inpayout <> 0 then raise exception 'FAIL S_UNPAID: unpaid order was paid out (% ledger rows)', v_inpayout; end if;
  select count(*) into v_inqueue from public.admin_payment_queue where id = v_oid;
  if v_inqueue <> 1 then raise exception 'FAIL S_UNPAID: delivered-unpaid not surfaced in payment queue (%).', v_inqueue; end if;
  raise notice 'PASS S_UNPAID: delivered-unpaid excluded from payout AND surfaced in admin_payment_queue';
end $$;
