-- reconcile_cash_ledger idempotence — audit 2026-08-13 CRIT. The hourly cron
-- inserted a fresh fraud_flag + a push per admin EVERY run while a drift stayed
-- unresolved (observed live: 54 duplicate flags x2 couriers + 108 pushes over
-- 6 days for the same 2 incidents). New rule: one OPEN (unreviewed) flag per
-- courier+kind; a new flag may only appear after the old one is reviewed.
-- Also asserts the historical-drift backfill left the live ledger clean.

do $$
declare
  v_courier uuid; v_flags int; v_pushes int; v_admins int;
begin
  -- a quiet courier with no cash orders: inject synthetic 500 MDL drift
  select c.id into v_courier from public.couriers c
  where not exists (select 1 from public.orders o where o.courier_id = c.id
                    and o.status='delivered' and o.payment_method='cash' and o.payment_status='paid')
    and not exists (select 1 from public.courier_cash_movements m where m.courier_id = c.id)
  limit 1;
  if v_courier is null then raise exception 'FAIL arrange: no quiet courier available'; end if;
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  values (v_courier, 'collected', 500, 'sim synthetic drift (rolled back)');
  select count(*) into v_admins from public.profiles where role='platform_admin';

  -- ===== R1: two runs -> exactly ONE open flag + one notification batch =====
  perform public.reconcile_cash_ledger();
  perform public.reconcile_cash_ledger();
  select count(*) into v_flags from public.fraud_flags
  where courier_id = v_courier and kind='cash_ledger_drift' and reviewed_at is null;
  if v_flags <> 1 then
    raise exception 'FAIL R1: % open drift flags after 2 runs (expected 1 — duplicates spam admins hourly)', v_flags;
  end if;
  select count(*) into v_pushes from public.notification_outbox
  where tag='cash' and body like '%'||v_courier||'%';
  if v_pushes <> v_admins then
    raise exception 'FAIL R1b: % cash pushes after 2 runs (expected % — one per admin, once)', v_pushes, v_admins;
  end if;
  raise notice 'PASS R1: one open flag + one notification batch across repeated runs';

  -- ===== R2: after review, a persisting drift may flag again =====
  update public.fraud_flags set reviewed_at = now()
  where courier_id = v_courier and kind='cash_ledger_drift' and reviewed_at is null;
  perform public.reconcile_cash_ledger();
  select count(*) into v_flags from public.fraud_flags
  where courier_id = v_courier and kind='cash_ledger_drift' and reviewed_at is null;
  if v_flags <> 1 then
    raise exception 'FAIL R2: expected a fresh flag after review while drift persists, got %', v_flags;
  end if;
  raise notice 'PASS R2: reviewed + persisting drift re-flags once';

  -- neutralize the synthetic drift so R3 (same transaction) sees honest state
  -- refund_reversal lowers the ledger WITHOUT entering the recompute formula
  -- (offload would count on both sides and leave a permanent +500 phantom drift)
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  values (v_courier, 'refund_reversal', -500, 'sim synthetic drift neutralized (rolled back)');
end $$;

-- ===== R3: live ledger is clean post-backfill (no courier drifts > 50) =====
do $$
declare v_bad int;
begin
  select count(*) into v_bad from (
    select c.id,
      public.courier_cash_balance(c.id)
      - ( coalesce((select sum(o.total_mdl) from public.orders o
                    where o.courier_id=c.id and o.status='delivered'
                      and o.payment_method='cash' and o.payment_status='paid'),0)
        + coalesce((select sum(m.amount_mdl) from public.courier_cash_movements m
                    where m.courier_id=c.id and m.kind='offload'),0) ) as drift
    from public.couriers c
  ) t where abs(t.drift) > 50;
  if v_bad <> 0 then
    raise exception 'FAIL R3: % couriers still carry >50 MDL historical ledger drift', v_bad;
  end if;
  raise notice 'PASS R3: live ledger reconciles for every courier';
end $$;
