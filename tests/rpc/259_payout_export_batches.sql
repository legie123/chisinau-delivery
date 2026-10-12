-- 259: settlement is bound to the EXPORTED file, not to whatever the page shows (red-team round 2,
-- HIGH, migration 20261012000411). Before: the CSV was computed at download, the page button at
-- render; a refund between them made the page carry the new net and settle the clawback too ->
-- bank got 240, ledger said 160, 80 MDL overpaid. Now admin_create_payout_export() freezes a batch
-- (per payee: exact payout ids, net, IBAN at export time); admin_settle_export_line marks exactly
-- those rows paid. A clawback created after the export stays pending and is netted next export.
-- Rows in an open batch are never exported twice; a batch can be voided to release them; an IBAN
-- changed since the payee's last payment must be confirmed before settling.
do $$
declare
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  c_staff constant uuid := 'a0000000-0000-0000-0000-000000000003';
  v_rest uuid; v_courier uuid; v_x uuid; v_e1 uuid; v_e2 uuid; v_e3 uuid;
  v_line record; v_pending numeric; v_n int;
begin
  select restaurant_id into v_rest from public.restaurant_staff where user_id = c_staff order by restaurant_id limit 1;
  select id into v_courier from public.couriers order by created_at limit 1;
  -- isolate: no other pending rows, no open batches for these payees; IBANs on file
  update public.payouts set status = 'paid', paid_at = now() - interval '30 days' where status = 'pending';
  delete from public.payout_accounts where recipient_id in (v_rest, v_courier);
  insert into public.payout_accounts (recipient_type, recipient_id, iban, holder_name, updated_at) values
    ('restaurant', v_rest, 'MD24AG000225100013104168', 'Restaurant SRL', now() - interval '60 days'),
    ('courier', v_courier, 'MD24AG000225100013104168', 'Curier', now() - interval '60 days');
  delete from public.payout_account_changes where recipient_id in (v_rest, v_courier);

  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 100, 20, 30, 120,
          '2028-07-05 20:00'::timestamp at time zone 'Europe/Chisinau') returning id into v_x;
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 200, 20, 30, 220,
          '2028-07-06 20:00'::timestamp at time zone 'Europe/Chisinau');
  perform public.generate_payouts_internal('2028-07-03', '2028-07-09');

  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  -- 259.1 export, THEN a refund lands, THEN settle: exactly the exported rows are paid, the clawback stays pending
  v_e1 := public.admin_create_payout_export();
  select * into v_line from public.payout_export_lines where export_id = v_e1 and recipient_type = 'restaurant' and recipient_id = v_rest;
  perform public.admin_update_payment_status(v_x, 'refund_pending', 'sim 259');
  perform public.admin_update_payment_status(v_x, 'refunded', 'sim 259');
  perform public.admin_settle_export_line(v_e1, 'restaurant', v_rest);
  if exists (select 1 from public.payouts where id = any(v_line.payout_ids) and status <> 'paid') then
    raise exception 'FAIL 259.1: exported rows not all paid';
  end if;
  select sum(net_mdl) into v_pending from public.payouts where recipient_type = 'restaurant' and recipient_id = v_rest and status = 'pending';
  if v_pending is null or v_pending >= 0 then
    raise exception 'FAIL 259.1: the post-export clawback was settled with the batch (pending now %)', v_pending;
  end if;
  raise notice 'PASS 259.1: settled exactly the exported % MDL; the later clawback (%) stays pending', v_line.net_mdl, v_pending;

  -- 259.2 the open courier line is not exported twice; voiding releases it
  begin
    v_e2 := public.admin_create_payout_export();
  exception when raise_exception then v_e2 := null;    -- nothing new to export is fine
  end;
  if v_e2 is not null and exists (select 1 from public.payout_export_lines where export_id = v_e2 and recipient_id = v_courier) then
    raise exception 'FAIL 259.2: rows of an open batch were exported again';
  end if;
  perform public.admin_void_payout_export(v_e1);
  v_e3 := public.admin_create_payout_export();
  if not exists (select 1 from public.payout_export_lines where export_id = v_e3 and recipient_id = v_courier) then
    raise exception 'FAIL 259.2: voiding did not release the courier rows';
  end if;
  raise notice 'PASS 259.2: an open batch blocks a double export; void releases it';

  -- 259.3 the clawback is netted into the next restaurant payment
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 300, 20, 30, 320,
          '2028-07-12 20:00'::timestamp at time zone 'Europe/Chisinau');
  perform public.generate_payouts_internal('2028-07-10', '2028-07-16');
  perform public.admin_void_payout_export(v_e3);
  v_e3 := public.admin_create_payout_export();
  select * into v_line from public.payout_export_lines where export_id = v_e3 and recipient_type = 'restaurant' and recipient_id = v_rest;
  if v_line.net_mdl <> (select sum(net_mdl) from public.payouts where id = any(v_line.payout_ids)) or array_length(v_line.payout_ids, 1) < 2 then
    raise exception 'FAIL 259.3: next export did not net the clawback (net %, rows %)', v_line.net_mdl, array_length(v_line.payout_ids, 1);
  end if;
  raise notice 'PASS 259.3: the pending clawback is netted into the next export (% MDL)', v_line.net_mdl;

  -- 259.4 IBAN changed since the last payment: settle needs an explicit confirmation
  perform set_config('request.jwt.claims', json_build_object('sub', c_staff, 'role', 'authenticated')::text, true);
  perform public.set_payout_account('restaurant', v_rest, 'RO49AAAA1B31007593840000', 'Altcineva SRL');
  -- now() is frozen inside one transaction: the change happens "after" the 259.1 payment
  update public.payout_account_changes set changed_at = now() + interval '1 minute'
   where recipient_type = 'restaurant' and recipient_id = v_rest and changed_at = now();
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  perform public.admin_void_payout_export(v_e3);
  v_e3 := public.admin_create_payout_export();
  select * into v_line from public.payout_export_lines where export_id = v_e3 and recipient_type = 'restaurant' and recipient_id = v_rest;
  if not v_line.iban_changed or v_line.iban is distinct from 'RO49AAAA1B31007593840000' then
    raise exception 'FAIL 259.4: line not flagged / wrong IBAN snapshot: %', row(v_line.iban_changed, v_line.iban);
  end if;
  begin
    perform public.admin_settle_export_line(v_e3, 'restaurant', v_rest);
    raise exception 'FAIL 259.4: settled a changed IBAN without confirmation';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform public.admin_settle_export_line(v_e3, 'restaurant', v_rest, true);
  raise notice 'PASS 259.4: an IBAN changed since the last payment is flagged and needs confirmation';

  -- 259.5 a settled line cannot be settled again
  begin
    perform public.admin_settle_export_line(v_e3, 'restaurant', v_rest, true);
    raise exception 'FAIL 259.5: settled twice';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- 259.6 non-admin refused
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_create_payout_export();
    raise exception 'FAIL 259.6: a customer created an export';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
  if exists (select 1 from pg_proc where proname = 'admin_settle_payee') then
    raise exception 'FAIL 259.6: the page-bound admin_settle_payee still exists';
  end if;
  raise notice 'PASS 259.5-6: once only, admin only, the old page-bound settle is gone';
end $$;

do $$
begin
  if has_table_privilege('anon', 'public.payout_export_lines', 'select')
     or has_function_privilege('anon', 'public.admin_create_payout_export()', 'execute') then
    raise exception 'FAIL 259.7: anon has access';
  end if;
  raise notice 'PASS 259.7: anon locked out';
end $$;
