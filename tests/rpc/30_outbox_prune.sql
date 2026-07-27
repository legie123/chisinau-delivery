-- DB hygiene order 8 — notification_outbox weekly prune. Rolled back by runner.

do $$
declare
  v_user uuid := 'a0000000-0000-0000-0000-000000000001'; -- client@test.md
  v_old_sent uuid;
  v_old_failed uuid;
  v_recent_sent uuid;
  v_old_pending uuid;
  v_deleted int;
  v_remaining int;
begin
  -- old, sent >30d ago -> pruned
  insert into public.notification_outbox (user_id, title, body, url, tag, created_at, sent_at, attempts)
  values (v_user, 'old sent', '', '/', 'test:old-sent', now() - interval '40 days', now() - interval '40 days', 1)
  returning id into v_old_sent;

  -- old, never sent, attempts exhausted (dead-lettered by claim's own max-attempts) -> pruned
  insert into public.notification_outbox (user_id, title, body, url, tag, created_at, sent_at, attempts)
  values (v_user, 'old failed', '', '/', 'test:old-failed', now() - interval '40 days', null, 5)
  returning id into v_old_failed;

  -- recent, sent -> kept (inside the 30-day window regardless of status)
  insert into public.notification_outbox (user_id, title, body, url, tag, created_at, sent_at, attempts)
  values (v_user, 'recent sent', '', '/', 'test:recent-sent', now() - interval '5 days', now() - interval '5 days', 1)
  returning id into v_recent_sent;

  -- old, still pending (attempts < 5, never sent) -> kept, still eligible for retry
  insert into public.notification_outbox (user_id, title, body, url, tag, created_at, sent_at, attempts)
  values (v_user, 'old pending', '', '/', 'test:old-pending', now() - interval '40 days', null, 2)
  returning id into v_old_pending;

  v_deleted := public.prune_notification_outbox();

  if v_deleted < 2 then
    raise exception 'FAIL: expected at least 2 rows pruned, got %', v_deleted;
  end if;

  if exists (select 1 from public.notification_outbox where id = v_old_sent) then
    raise exception 'FAIL: old sent row survived the prune';
  end if;
  if exists (select 1 from public.notification_outbox where id = v_old_failed) then
    raise exception 'FAIL: old dead-lettered row survived the prune';
  end if;
  if not exists (select 1 from public.notification_outbox where id = v_recent_sent) then
    raise exception 'FAIL: recent sent row was wrongly pruned';
  end if;
  if not exists (select 1 from public.notification_outbox where id = v_old_pending) then
    raise exception 'FAIL: old-but-still-pending row was wrongly pruned';
  end if;

  select count(*) into v_remaining from public.notification_outbox
  where id in (v_old_sent, v_old_failed, v_recent_sent, v_old_pending);
  if v_remaining <> 2 then
    raise exception 'FAIL: expected exactly 2 of the 4 fixture rows to survive, got %', v_remaining;
  end if;

  raise notice 'PASS: prune_notification_outbox removed old sent/dead-lettered rows, kept recent + still-pending';
end $$;

-- statement_timeout hardening — every pg_cron-invoked function carries a hard ceiling.
do $$
declare
  v_missing text;
begin
  select string_agg(fn, ', ') into v_missing
  from unnest(array[
    'expire_stale_orders()', 'expire_dispatch_offers()', 'refresh_prep_stats()',
    'purge_expired_pii()', 'close_stale_courier_shifts()',
    'claim_notification_outbox(integer)', 'prune_notification_outbox()'
  ]) as fn
  where not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.oid = ('public.' || fn)::regprocedure
      and p.proconfig is not null
      and exists (select 1 from unnest(p.proconfig) c where c like 'statement_timeout=%')
  );

  if v_missing is not null then
    raise exception 'FAIL: missing statement_timeout on cron-invoked function(s): %', v_missing;
  end if;

  raise notice 'PASS: all 7 cron-invoked functions carry a statement_timeout';
end $$;
