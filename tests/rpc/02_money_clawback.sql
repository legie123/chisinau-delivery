-- Wave 1b sims (fixes for MoneyVerify's 5 findings). BEGIN/ROLLBACK, nothing persists.

-- ===== #1 clawback: settled order refunded -> negative offset payouts + ledger reversed + visible =====
do $$
declare v_rest uuid; v_oid uuid; v_neg_rest numeric; v_neg_cour numeric; v_rev int; v_queue int;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl, delivered_at, courier_id)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest, 'delivered','online_gateway','paid',
          1000, 65, 1065, 0, now(), 'c9a68659-0734-413e-95d0-87cd21f4a0f7')
  returning id into v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  perform public.admin_generate_payouts(current_date, current_date);      -- settle it
  update public.payouts set status='paid', paid_at=now() where status='pending';  -- recipients paid

  -- now refund the delivered+paid+settled order
  update public.orders set payment_status='refunded' where id = v_oid;

  select coalesce(sum(net_mdl),0) into v_neg_rest from public.payouts where recipient_type='restaurant' and recipient_id=v_rest and net_mdl < 0;
  select coalesce(sum(net_mdl),0) into v_neg_cour from public.payouts where recipient_type='courier' and net_mdl < 0;
  select count(*) into v_rev from public.payout_orders where order_id=v_oid and reversed_at is not null;
  select count(*) into v_queue from public.admin_payment_queue where id=v_oid;

  if v_neg_rest >= 0 then raise exception 'FAIL #1: no restaurant clawback (net %))', v_neg_rest; end if;
  if v_neg_cour >= 0 then raise exception 'FAIL #1: no courier clawback (net %)', v_neg_cour; end if;
  if v_rev <> 2 then raise exception 'FAIL #1: ledger not reversed (% rows)', v_rev; end if;
  if v_queue <> 1 then raise exception 'FAIL #1: refunded-settled order not visible in queue'; end if;
  raise notice 'PASS #1: refund clawed back (rest net=%, courier net=%), ledger reversed, order visible', v_neg_rest, v_neg_cour;
end $$;

-- ===== #2 straggler: same-period re-run after PAID no longer drops a late order =====
do $$
declare v_rest uuid; v_a uuid; v_b uuid; v_settled int;
begin
  select id into v_rest from public.restaurants where is_active order by name desc limit 1; -- a different rest to isolate
  -- order A delivered earlier in July, settle + mark paid
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, delivered_at)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest,'delivered','cash','paid', 500,20,520, (current_date - 10)::timestamptz)
  returning id into v_a;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  perform public.admin_generate_payouts(date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date);
  update public.payouts set status='paid' where recipient_type='restaurant' and recipient_id=v_rest and status='pending';

  -- late straggler B, same month, then RE-RUN the identical period
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, delivered_at)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest,'delivered','cash','paid', 800,20,820, (current_date - 5)::timestamptz)
  returning id into v_b;
  perform public.admin_generate_payouts(date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date);

  select count(*) into v_settled from public.payout_orders where order_id=v_b and recipient_type='restaurant';
  if v_settled <> 1 then raise exception 'FAIL #2: straggler dropped on same-period re-run (% ledger rows)', v_settled; end if;
  raise notice 'PASS #2: straggler settled on same-period re-run (fresh pending payout), not dropped';
end $$;

-- ===== #3 catering tip set during quote phase is added ON TOP at confirm =====
do $$
declare v_oid uuid; v_total numeric;
begin
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl)
  values ('catering','a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','pending_restaurant','cash','unpaid', 200, 45, 245, 100)
  returning id into v_oid;
  insert into public.catering_details (order_id, event_date, guest_count, event_address_text, contact_person, contact_phone, quote_status, quoted_total_mdl)
  values (v_oid, current_date+7, 40, 'Str. X', 'Ana', '+37360000001', 'quoted', 6000);
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  perform public.confirm_catering_quote(v_oid);
  select total_mdl into v_total from public.orders where id=v_oid;
  if v_total <> 6100 then raise exception 'FAIL #3: catering confirm dropped pre-set tip -> total % (expected 6100)', v_total; end if;
  raise notice 'PASS #3: pre-confirm catering tip added on top (total=%)', v_total;
end $$;

-- ===== #4 admin direct UPDATE cannot deliver an online-unpaid order; delivered_at enforced =====
do $$
declare v_rest uuid; v_oid uuid; v_raised boolean := false; v_dat timestamptz;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard','a0000000-0000-0000-0000-000000000001', v_rest,'en_route','online_gateway','pending_capture', 200,20,220,'c9a68659-0734-413e-95d0-87cd21f4a0f7')
  returning id into v_oid;
  begin
    update public.orders set status='delivered' where id=v_oid;  -- direct admin-style write, bypassing the RPC
  exception when others then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL #4: admin direct UPDATE delivered an online-unpaid order'; end if;

  -- pay, then a direct delivered UPDATE must stamp delivered_at via the trigger
  update public.orders set payment_status='paid' where id=v_oid;
  update public.orders set status='delivered' where id=v_oid;
  select delivered_at into v_dat from public.orders where id=v_oid;
  if v_dat is null then raise exception 'FAIL #4: delivered_at not stamped on direct UPDATE path'; end if;
  raise notice 'PASS #4: gate + delivered_at enforced on the direct-UPDATE path too (delivered_at=%)', v_dat;
end $$;

-- ===== #5 catering quote below the delivery fee is rejected =====
do $$
declare v_oid uuid; v_raised boolean := false;
begin
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('catering','a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','pending_restaurant','cash','unpaid', 0, 45, 45)
  returning id into v_oid;
  insert into public.catering_details (order_id, event_date, guest_count, event_address_text, contact_person, contact_phone, quote_status)
  values (v_oid, current_date+7, 30, 'Str. Y', 'Dan', '+37360000002', 'requested');
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000003','role','authenticated')::text, true);
  begin
    perform public.submit_catering_quote(v_oid, 30);  -- below the 45 fee
  exception when others then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL #5: quote below delivery fee was accepted'; end if;
  perform public.submit_catering_quote(v_oid, 5000); -- valid one still works
  raise notice 'PASS #5: sub-fee catering quote rejected; valid quote accepted';
end $$;
