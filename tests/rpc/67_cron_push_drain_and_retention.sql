-- 20261002000000 + 20261002000100: the push drain must fire fast enough for a 30s dispatch offer,
-- and cron history must have a retention job (else job_run_details grows ~43k rows/day unbounded).
do $$
declare v_sched text; v_cmd text;
begin
  select schedule into v_sched from cron.job where jobname = 'drain-push-outbox';
  if v_sched is distinct from '2 seconds' then
    raise exception 'FAIL: drain-push-outbox schedule is % (expected 2 seconds)', v_sched;
  end if;
  select command into v_cmd from cron.job where jobname = 'purge-cron-history';
  if v_cmd is null or v_cmd not ilike '%delete from cron.job_run_details%' then
    raise exception 'FAIL: no purge-cron-history job deleting cron.job_run_details';
  end if;
  raise notice 'PASS: drain 2s + cron history retention job present';
end $$;
