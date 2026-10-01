-- Offer window is 30s; a 10s drain could burn a third of it before the push even leaves.
-- Drain every 2s (pg_cron >= 1.5 seconds syntax). Body only fires when the outbox has unsent rows.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'drain-push-outbox'),
  schedule := '2 seconds'
);
