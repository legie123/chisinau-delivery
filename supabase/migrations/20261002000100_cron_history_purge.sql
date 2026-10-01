-- cron.job_run_details had no retention: 264k rows / 114 MB since 2026-08-06, and the 2s push drain
-- (20261002000000) adds ~43k rows/day. Keep 3 days of history (enough to debug a failed run).
select cron.schedule(
  'purge-cron-history',
  '30 4 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '3 days' $$
);
