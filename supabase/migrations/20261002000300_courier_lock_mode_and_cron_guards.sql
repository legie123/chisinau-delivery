-- Three findings of the 2026-10-02 adversarial verify, each a one-line delta on the LIVE body.
--
-- 1. Deadlock assign_courier / accept_dispatch_offer  vs  dispatch_order (sweeper rescue, cascade,
--    mark_ready). The claim RPCs lock the courier row FOR UPDATE, then the order. dispatch_order
--    locks the order, then inserts an offer whose FK check takes KEY SHARE on the candidate courier
--    — and KEY SHARE conflicts with FOR UPDATE: a cycle (reproduced: 38 deadlocks / 5 rounds of
--    claims racing the sweeper, scripts/concurrency). FOR NO KEY UPDATE still serializes these RPCs
--    against each other but is compatible with FK KEY SHARE, so the cycle cannot form.
--    The sweeper takes the same mode for consistency.
-- 2. drain-push-outbox fired on `sent_at is null`, but the drain only claims `attempts < 5`: one
--    dead row meant a no-op POST every 2s until the 30-day prune.
-- 3. purge-cron-history never removed runs with a NULL end_time (interrupted runs).
--
-- Each delta is applied to the live definition and fails loudly if the expected text is absent,
-- instead of silently re-creating a stale copy (CLAUDE.md hard rule 9).

do $$
declare
  r record;
  d text;
begin
  for r in
    select * from (values
      ('public.assign_courier(uuid)',
       'from public.couriers where id = v_courier_id for update;',
       'from public.couriers where id = v_courier_id for no key update;'),
      ('public.accept_dispatch_offer(uuid)',
       'from public.couriers where id = v_courier_id for update;',
       'from public.couriers where id = v_courier_id for no key update;'),
      ('public.expire_dispatch_offers()',
       'from public.couriers where id = v_rec.courier_id for update skip locked;',
       'from public.couriers where id = v_rec.courier_id for no key update skip locked;')
    ) as t(fn, old_txt, new_txt)
  loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if position(r.old_txt in d) = 0 then
      raise exception 'live body of % drifted: expected text not found', r.fn;
    end if;
    execute replace(d, r.old_txt, r.new_txt);
  end loop;
end $$;

-- statement_timeout lives in the function's proconfig (SET clause), which pg_get_functiondef
-- reproduces, so the sweeper keeps its 30s cap.

do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'drain-push-outbox';
  if position('where sent_at is null);' in v_cmd) = 0 then
    raise exception 'drain-push-outbox command drifted';
  end if;
  perform cron.alter_job(
    job_id := (select jobid from cron.job where jobname = 'drain-push-outbox'),
    command := replace(v_cmd, 'where sent_at is null);', 'where sent_at is null and attempts < 5);')
  );
  perform cron.alter_job(
    job_id := (select jobid from cron.job where jobname = 'purge-cron-history'),
    command := $c$ delete from cron.job_run_details
                   where coalesce(end_time, start_time) < now() - interval '3 days' $c$
  );
end $$;
