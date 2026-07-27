-- DB hygiene wave, order 8/8+2 — the notification_outbox (20260718000200) has
-- no retention: every sent + every dead-lettered (attempts exhausted, never
-- delivered) row accumulates forever. Modeled on purge_expired_pii's shape
-- (20260726000500 / 20260727000200): a SECURITY DEFINER function, revoked from
-- everyone but pg_cron, run on a schedule.
--
-- Pruned = "done with", not "old": sent_at IS NOT NULL (delivered) OR attempts
-- >= 5 (claim_notification_outbox's own max-attempts ceiling — a row that hit 5
-- and never sent is dead, claim_notification_outbox will never pick it up
-- again). A still-pending row (attempts < 5, sent_at null) is kept regardless
-- of age — it may still be retried. Anything inside the 30-day window is kept
-- regardless of status, so a fresh failure/success is never touched.
create or replace function public.prune_notification_outbox()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.notification_outbox
  where created_at < now() - interval '30 days'
    and (sent_at is not null or attempts >= 5);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.prune_notification_outbox() from public, anon, authenticated;

-- Weekly — this table isn't hot-path (write volume is push events, not orders),
-- so daily-cadence pruning would be needless churn. Sunday 04:00 (Chișinău is
-- UTC+2/+3; the exact minute is not load-sensitive, chosen to sit clear of the
-- 03:15 purge-expired-pii job).
select cron.schedule('prune-notification-outbox', '0 4 * * 0', $$select public.prune_notification_outbox();$$);

-- ---------------------------------------------------------------------------
-- statement_timeout hardening — every pg_cron-invoked function gets a hard
-- ceiling so one runaway iteration (lock contention, an unindexed scan after a
-- future schema change, etc.) can never wedge a cron worker slot indefinitely.
-- 30s is generous headroom over measured local run times for all of these
-- (small aggregates / bounded deletes on pilot-scale data) while still being a
-- real backstop. Enumerated from `select jobname, command from cron.job` (the
-- live schedule) plus claim_notification_outbox (the drain flow's DB half —
-- the actual push send happens in the app, outside Postgres, so it is
-- deliberately NOT wrapped here).
alter function public.expire_stale_orders() set statement_timeout = '30s';
alter function public.expire_dispatch_offers() set statement_timeout = '30s';
alter function public.refresh_prep_stats() set statement_timeout = '30s';
alter function public.purge_expired_pii() set statement_timeout = '30s';
alter function public.close_stale_courier_shifts() set statement_timeout = '30s';
alter function public.claim_notification_outbox(int) set statement_timeout = '30s';
alter function public.prune_notification_outbox() set statement_timeout = '30s';

-- No cash-reconciliation function runs on a cron schedule today —
-- admin_update_payment_status's 'unpaid'->'paid' manual-reconciliation
-- transition (20260717001800) is an admin-invoked RPC, not a pg_cron job (see
-- `cron.job`), so it is out of scope for this hardening pass by design, not by
-- oversight.
