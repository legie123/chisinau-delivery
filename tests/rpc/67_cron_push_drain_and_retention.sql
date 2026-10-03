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

-- 20261002000300: the drain guard must match what the drain can claim (attempts < 5), else one dead
-- row makes the job POST a no-op every 2s for 30 days; and interrupted runs (NULL end_time) must
-- be purged too. Behavioral: execute the live job commands and look at their effects.
do $$
declare v_cmd text; q0 bigint; q1 bigint; q2 bigint; v_left int;
begin
  update public.notification_outbox set sent_at = now() where sent_at is null;  -- isolate (rolled back)
  insert into public.notification_outbox (user_id, title, body, url, tag, attempts)
  values ('a0000000-0000-0000-0000-000000000001', 'sim67 dead', 'x', '/', 'sim67', 5);

  select command into v_cmd from cron.job where jobname = 'drain-push-outbox';
  select count(*) into q0 from net.http_request_queue;
  execute v_cmd;
  select count(*) into q1 from net.http_request_queue;
  if q1 <> q0 then
    raise exception 'FAIL: drain fired a POST for an outbox holding only a dead row (attempts=5)';
  end if;

  insert into public.notification_outbox (user_id, title, body, url, tag)
  values ('a0000000-0000-0000-0000-000000000001', 'sim67 live', 'x', '/', 'sim67');
  execute v_cmd;
  select count(*) into q2 from net.http_request_queue;
  if q2 <> q1 + 1 then
    raise exception 'FAIL: drain did not fire for a claimable row (queue % -> %)', q1, q2;
  end if;

  insert into cron.job_run_details (jobid, runid, database, username, command, status, start_time, end_time)
  values ((select jobid from cron.job where jobname = 'purge-cron-history'), -6767, 'postgres', 'postgres',
          'sim67', 'starting', now() - interval '10 days', null);
  select command into v_cmd from cron.job where jobname = 'purge-cron-history';
  execute v_cmd;
  select count(*) into v_left from cron.job_run_details where runid = -6767;
  if v_left <> 0 then
    raise exception 'FAIL: purge kept an interrupted run (NULL end_time) older than 3 days';
  end if;
  raise notice 'PASS: drain guard = claimable rows only; purge removes interrupted runs';
end $$;
