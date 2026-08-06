-- MARELE AUDIT 2026-08-03 — MoneySectorAudit #2 (P1).
-- Proves a refund of a CASH order reverses the courier's collected cash in the
-- ledger, so the balance isn't left inflated (false cap / permanent reconcile
-- drift). Runner wraps in BEGIN/ROLLBACK as postgres.

do $$
declare
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_courier uuid;
  v_o uuid; v_bal_before numeric; v_bal_after numeric; v_rev numeric; n int;
begin
  select id into v_rest from public.restaurants where is_active limit 1;
  -- a courier well under the cap so the +100 collection doesn't trip auto-offline.
  select id into v_courier from public.couriers where public.courier_cash_balance(id) < 500 limit 1;

  v_bal_before := public.courier_cash_balance(v_courier);

  -- cash order delivered + paid, courier collected 100 at handover.
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, delivered_at)
  values ('standard', v_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 80, 20, 100, now())
  returning id into v_o;
  insert into public.courier_cash_movements (courier_id, order_id, kind, amount_mdl)
  values (v_courier, v_o, 'collected', 100);

  if public.courier_cash_balance(v_courier) <> v_bal_before + 100 then
    raise exception 'FAIL setup: collection did not raise balance by 100';
  end if;

  -- Refund the order — fires clawback_settled_order_on_refund.
  update public.orders set payment_status = 'refunded' where id = v_o;

  -- A refund_reversal of -100 must exist for this order+courier.
  select count(*), coalesce(sum(amount_mdl),0) into n, v_rev
  from public.courier_cash_movements
  where order_id = v_o and kind = 'refund_reversal' and courier_id = v_courier;
  if n <> 1 then raise exception 'FAIL: expected 1 refund_reversal, got %', n; end if;
  if v_rev <> -100 then raise exception 'FAIL: refund_reversal amount % (expected -100)', v_rev; end if;

  -- Balance is back to where it started (collected 100 - reversal 100 = 0 net).
  v_bal_after := public.courier_cash_balance(v_courier);
  if v_bal_after <> v_bal_before then
    raise exception 'FAIL: balance % after refund (expected % — collection fully reversed)', v_bal_after, v_bal_before;
  end if;

  raise notice 'PASS: cash refund reverses the collected float (refund_reversal -100), balance realigned';
end $$;
