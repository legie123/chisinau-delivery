-- Directive 10 leftovers — cash-ops hardening.
-- (a) courier_has_capacity() folds in the cash cap (single source of truth
--     for dispatch), (b) effective_cash_cap() tiers the cap by tenure
--     (<30d -> least(cap,1000)), (c) reconcile_cash_ledger() hourly drift
--     check (signal-only: fraud_flags + notification_outbox).
-- Rolled back by runner.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_mature_courier uuid := 'c1000000-0000-0000-0000-000000000001'; -- courier user c0000000...0001
  v_new_courier uuid := 'c1000000-0000-0000-0000-000000000002';    -- courier user c0000000...0002
  v_clean_courier uuid := 'c1000000-0000-0000-0000-000000000003';  -- courier user c0000000...0003
  v_drift_courier uuid := 'c1000000-0000-0000-0000-000000000006';  -- courier user c0000000...0006
  v_cap numeric;
  v_has_capacity boolean;
  v_flag_count int;
  v_notif_count int;
begin
  -- Known baseline: no cash movements, no on-active-delivery status, none
  -- currently over/under any prior test's ceiling.
  delete from public.courier_cash_movements
  where courier_id in (v_mature_courier, v_new_courier, v_clean_courier, v_drift_courier);
  update public.couriers set status = 'offline'
  where id in (v_mature_courier, v_new_courier, v_clean_courier, v_drift_courier);

  -- Tenure: mature (>30d) vs new (<30d).
  update public.couriers set created_at = now() - interval '60 days' where id = v_mature_courier;
  update public.couriers set created_at = now() - interval '5 days' where id = v_new_courier;

  -- ==== 1. effective_cash_cap tiers by tenure ====
  v_cap := public.effective_cash_cap(v_mature_courier);
  if v_cap is distinct from 1500.00 then raise exception 'FAIL: mature effective cap = % (expected 1500.00)', v_cap; end if;

  v_cap := public.effective_cash_cap(v_new_courier);
  if v_cap is distinct from 1000.00 then raise exception 'FAIL: new-tenure effective cap = % (expected 1000.00, tiered)', v_cap; end if;

  -- ==== 2. dispatch skips an at-cap courier: courier_has_capacity() false
  --         once balance >= effective cap, true just under it ====
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl) values (v_mature_courier, 'collected', 1000.00);
  v_has_capacity := public.courier_has_capacity(v_mature_courier);
  if not v_has_capacity then raise exception 'FAIL: mature courier at 1000 (< 1500 cap) reported NO capacity'; end if;

  insert into public.courier_cash_movements (courier_id, kind, amount_mdl) values (v_mature_courier, 'collected', 500.00);
  -- balance now 1500 = cap -> enforce_cash_cap_offline already force-offlines it;
  -- courier_has_capacity must independently agree.
  v_has_capacity := public.courier_has_capacity(v_mature_courier);
  if v_has_capacity then raise exception 'FAIL: mature courier AT cap (1500) still reported capacity'; end if;

  -- ==== 3. tenure<30d courier blocked at 1000, not 1500 ====
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl) values (v_new_courier, 'collected', 999.00);
  v_has_capacity := public.courier_has_capacity(v_new_courier);
  if not v_has_capacity then raise exception 'FAIL: new-tenure courier at 999 (< tiered 1000) reported NO capacity'; end if;

  insert into public.courier_cash_movements (courier_id, kind, amount_mdl) values (v_new_courier, 'collected', 1.00);
  -- balance now 1000: blocked for a NEW courier even though a mature courier
  -- at the same 1000 balance (test 2 above) still had capacity.
  v_has_capacity := public.courier_has_capacity(v_new_courier);
  if v_has_capacity then raise exception 'FAIL: new-tenure courier at 1000 (tiered cap) still reported capacity — should be blocked, not 1500'; end if;

  -- enforce_cash_cap_offline must also have force-offlined the new courier at
  -- the TIERED 1000, not the flat 1500 (accrual-trigger side of the fold).
  perform 1 from public.couriers where id = v_new_courier and status = 'offline';
  if not found then raise exception 'FAIL: new-tenure courier not auto-offlined at tiered cap 1000'; end if;

  -- ==== 4. reconciliation: clean courier gets no flag ====
  perform public.reconcile_cash_ledger();

  select count(*) into v_flag_count from public.fraud_flags
  where courier_id = v_clean_courier and kind = 'cash_ledger_drift';
  if v_flag_count <> 0 then raise exception 'FAIL: clean courier got a drift flag (count=%)', v_flag_count; end if;

  -- ==== 5. reconciliation: artificial drift IS flagged + admin notified ====
  -- Ledger row with no backing delivered/cash/paid order -> ledger (200) vs
  -- recomputed-from-orders (0) diverge by 200 > 50 MDL.
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  values (v_drift_courier, 'collected', 200.00, 'sim: artificial ledger row, no backing order');

  perform public.reconcile_cash_ledger();

  select count(*) into v_flag_count from public.fraud_flags
  where courier_id = v_drift_courier and kind = 'cash_ledger_drift'
    and (detail->>'drift_mdl')::numeric = 200.00;
  if v_flag_count = 0 then raise exception 'FAIL: artificial 200 MDL drift was not flagged in fraud_flags'; end if;

  select count(*) into v_notif_count from public.notification_outbox
  where user_id = v_admin and tag = 'cash' and body ilike '%' || v_drift_courier::text || '%';
  if v_notif_count = 0 then raise exception 'FAIL: no admin notification_outbox row for the flagged drift'; end if;

  -- Idempotency sanity: running it again with the same standing drift adds
  -- another flag (signal-only, no de-dup promised) but must not error/crash
  -- and must not touch the ledger itself (still append-only).
  perform public.reconcile_cash_ledger();
  perform 1 from public.courier_cash_movements where courier_id = v_drift_courier and kind = 'collected' and amount_mdl = 200.00;
  if not found then raise exception 'FAIL: reconcile_cash_ledger mutated/removed a ledger row (must be read-only)'; end if;

  raise notice 'PASS cash-ops-hardening: courier_has_capacity() folds the cash cap (dispatch source of truth), effective_cash_cap() tiers <30d couriers to 1000 vs 1500, accrual trigger force-offlines at the tiered cap, reconcile_cash_ledger() is silent for a clean courier and flags+notifies admin on an artificial >50 MDL drift without mutating the ledger';
end $$;
