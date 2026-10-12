-- 260 (red-team round 2 on 7fac27b + c9e299c, migration 20261012000412):
--   a) the catch-up has a floor: weeks before platform_settings.payouts_catchup_from (default: the first
--      period in the payouts ledger) are never paid by the cron — on a first production run the whole
--      history (orders settled outside the system) would otherwise be paid on the first Monday;
--   b) a holder-name-only change on payout_accounts is recorded too (IBAN unchanged).
do $$
declare
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_courier uuid; v_old uuid; v_new uuid; v_n int;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select id into v_courier from public.couriers order by created_at limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 100, 20, 30, 120,
          '2028-08-02 12:00'::timestamp at time zone 'Europe/Chisinau') returning id into v_old;   -- week 07-31
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 100, 20, 30, 120,
          '2028-08-09 12:00'::timestamp at time zone 'Europe/Chisinau') returning id into v_new;   -- week 08-07

  -- 260.1 explicit floor 2028-08-07: the earlier week is NOT paid, the later is
  update public.platform_settings set payouts_catchup_from = '2028-08-07' where id;
  perform public.generate_weekly_payouts('2028-08-21 04:00+00');
  if exists (select 1 from public.payout_orders where order_id = v_old) then
    raise exception 'FAIL 260.1: an order before the catch-up floor was paid';
  end if;
  if (select count(*) from public.payout_orders where order_id = v_new) <> 2 then
    raise exception 'FAIL 260.1: the order after the floor was not paid';
  end if;
  raise notice 'PASS 260.1: the catch-up stops at payouts_catchup_from';

  -- 260.2 default floor = first period in the ledger: lowering it below the ledger start does nothing new
  update public.platform_settings set payouts_catchup_from = null where id;
  if (select min(period_start) from public.payouts) > '2028-07-31' then
    raise exception 'FAIL 260.2: fixture assumption broken (ledger starts after the test week)';
  end if;
  perform public.generate_weekly_payouts('2028-08-21 04:00+00');
  if (select count(*) from public.payout_orders where order_id = v_old) <> 2 then
    raise exception 'FAIL 260.2: with the default floor (ledger start) the week inside the ledger range was not caught up';
  end if;
  raise notice 'PASS 260.2: default floor = the first period already in the payouts ledger';

  -- 260.3 holder-only change recorded
  insert into public.payout_accounts (recipient_type, recipient_id, iban, holder_name)
  values ('courier', v_courier, 'MD24AG000225100013104168', 'Ion')
  on conflict (recipient_type, recipient_id) do update set iban = excluded.iban, holder_name = excluded.holder_name;
  select count(*) into v_n from public.payout_account_changes where recipient_id = v_courier;
  update public.payout_accounts set holder_name = 'Altcineva' where recipient_type = 'courier' and recipient_id = v_courier;
  if (select count(*) from public.payout_account_changes where recipient_id = v_courier) <> v_n + 1 then
    raise exception 'FAIL 260.3: a holder-only change left no trace';
  end if;
  raise notice 'PASS 260.3: holder-only change recorded';
end $$;
