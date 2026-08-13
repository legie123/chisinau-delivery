-- Audit 2026-08-13 CRIT: reconcile_cash_ledger had no idempotence — every
-- hourly run inserted a fresh fraud_flag AND a push per admin for the SAME
-- unresolved drift (observed live: 54 duplicate flags × 2 couriers + 108
-- pushes over 6 days). Alert fatigue guaranteed; fraud_flags reads as 108
-- incidents instead of 2.
--
-- 1. reconcile_cash_ledger: flag+notify ONLY when no OPEN (unreviewed)
--    cash_ledger_drift flag exists for that courier. After an admin reviews
--    the flag, a persisting drift may legitimately flag once more.
--
-- 2. Historical regularization: the two REAL drifts (-772 / -430 MDL) come
--    from cash orders delivered BEFORE the cash-float ledger existed
--    (20260727000800) — no 'collected' movement was ever written for them.
--    Backfill: for every delivered+cash+paid order with no collected row,
--    insert the missing collected movement PLUS an equal offload (net zero:
--    the ledger reconciles without inflating anyone's cash-in-hand toward
--    the cap for money settled long ago).
--
-- 3. The existing pile of duplicate cash_ledger_drift flags is auto-reviewed:
--    the incident they all pointed at is resolved by (2).

create or replace function public.reconcile_cash_ledger()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare
  v_rec record;
  v_drift numeric;
  v_admin uuid;
begin
  for v_rec in
    select
      c.id as courier_id,
      public.courier_cash_balance(c.id) as ledger_balance,
      coalesce((
        select sum(o.total_mdl) from public.orders o
        where o.courier_id = c.id and o.status = 'delivered'
          and o.payment_method = 'cash' and o.payment_status = 'paid'
      ), 0)
      + coalesce((
        select sum(m.amount_mdl) from public.courier_cash_movements m
        where m.courier_id = c.id and m.kind = 'offload'
      ), 0) as recomputed_balance
    from public.couriers c
  loop
    v_drift := v_rec.ledger_balance - v_rec.recomputed_balance;
    if abs(v_drift) > 50
       -- idempotence: one OPEN incident per courier — never re-flag (and
       -- never re-push) while the previous drift flag awaits review
       and not exists (
         select 1 from public.fraud_flags f
         where f.courier_id = v_rec.courier_id
           and f.kind = 'cash_ledger_drift'
           and f.reviewed_at is null
       )
    then
      insert into public.fraud_flags (courier_id, kind, detail)
      values (
        v_rec.courier_id, 'cash_ledger_drift',
        jsonb_build_object(
          'ledger_balance', v_rec.ledger_balance,
          'recomputed_balance', v_rec.recomputed_balance,
          'drift_mdl', v_drift
        )
      );

      for v_admin in select id from public.profiles where role = 'platform_admin'
      loop
        insert into public.notification_outbox (user_id, title, body, url, tag)
        values (
          v_admin,
          'Discrepanță numerar curier',
          format('Curier %s: sold jurnal %s MDL vs. recalculat din comenzi %s MDL (diferență %s MDL).',
                 v_rec.courier_id, v_rec.ledger_balance, v_rec.recomputed_balance, v_drift),
          '/platform/fraud',
          'cash'
        );
      end loop;
    end if;
  end loop;
end;
$function$;

-- 2. Backfill: missing collected movements for pre-ledger cash deliveries,
--    paired with an equal offload so net cash-in-hand stays unchanged.
with missing as (
  select o.id as order_id, o.courier_id, o.total_mdl
  from public.orders o
  where o.status = 'delivered' and o.payment_method = 'cash' and o.payment_status = 'paid'
    and o.courier_id is not null
    and not exists (
      select 1 from public.courier_cash_movements m
      where m.order_id = o.id and m.kind = 'collected'
    )
),
ins_collected as (
  insert into public.courier_cash_movements (courier_id, order_id, kind, amount_mdl, note)
  select courier_id, order_id, 'collected', total_mdl,
         'regularizare istorică pre-ledger (audit 2026-08-13)'
  from missing
  returning courier_id, order_id, amount_mdl
)
insert into public.courier_cash_movements (courier_id, order_id, kind, amount_mdl, note)
select courier_id, order_id, 'offload', -amount_mdl,
       'regularizare istorică pre-ledger (audit 2026-08-13)'
from ins_collected;

-- 3. Auto-review the duplicate-flag pile — its incident is now regularized.
update public.fraud_flags
set reviewed_at = now()
where kind = 'cash_ledger_drift' and reviewed_at is null;
