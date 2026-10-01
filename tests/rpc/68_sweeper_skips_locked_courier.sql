-- 20261002000200: the offer sweeper must never WAIT on a courier row another session holds
-- (accept_dispatch_offer locks courier -> order -> offer; the old sweeper locked offer -> courier,
-- a deadlock cycle). A second psql session, started in the background via \!, holds the courier
-- row for 4s, as a mid-accept courier would (FOR NO KEY UPDATE: plain FOR UPDATE would queue
-- behind this session's own FK key-share lock from the offer insert and never hold anything); the sweeper must skip that offer instead of blocking.
-- Old body: lock_timeout error -> FAIL.

do $$
declare v_cid uuid; v_oid uuid;
begin
  select id into v_cid from public.couriers where user_id = 'c0000000-0000-0000-0000-000000000001';
  update public.dispatch_offers set status = 'cancelled' where courier_id = v_cid and status = 'offered';
  select id into v_oid from public.orders where status = 'delivered' order by created_at limit 1;
  update public.orders set status = 'ready_for_pickup', courier_id = null where id = v_oid;
  update public.dispatch_offers set status = 'cancelled' where order_id = v_oid and status = 'offered';
  insert into public.dispatch_offers (order_id, courier_id, score, expires_at)
  values (v_oid, v_cid, 1, now() - interval '1 second');
end $$;

\! psql -U postgres -d postgres -qAt -c "/* sim68-lock */ begin; select 1 from public.couriers where user_id = 'c0000000-0000-0000-0000-000000000001' for no key update; select pg_sleep(4); commit;" >/dev/null 2>&1 &
do $$
declare v_cid uuid; v_status text; i int := 0;
begin
  -- wait (max 5s) until the background session really holds the lock; never pass vacuously
  while not exists (select 1 from pg_stat_activity where query like '/* sim68-lock */%' and wait_event = 'PgSleep') loop
    i := i + 1;
    if i > 50 then raise exception 'FAIL: harness - background lock session never started'; end if;
    perform pg_sleep(0.1);
    perform pg_stat_clear_snapshot();  -- pg_stat_activity is snapshotted once per transaction
  end loop;
  select id into v_cid from public.couriers where user_id = 'c0000000-0000-0000-0000-000000000001';
  perform set_config('lock_timeout', '1500ms', true);
  begin
    perform public.expire_dispatch_offers();
  exception when lock_not_available then
    raise exception 'FAIL: sweeper blocked on a courier row locked by another session (deadlock-prone lock order)';
  end;
  select status into v_status from public.dispatch_offers where courier_id = v_cid order by created_at desc limit 1;
  if v_status <> 'offered' then
    raise exception 'FAIL: offer of a locked courier was touched (status %), expected skipped until next tick', v_status;
  end if;
end $$;

select pg_sleep(4.5);

do $$
declare v_cid uuid; v_status text;
begin
  select id into v_cid from public.couriers where user_id = 'c0000000-0000-0000-0000-000000000001';
  perform public.expire_dispatch_offers();
  select status into v_status from public.dispatch_offers where courier_id = v_cid order by created_at desc limit 1;
  if v_status <> 'expired' then
    raise exception 'FAIL: offer not expired on the next unlocked tick (status %)', v_status;
  end if;
  raise notice 'PASS: sweeper skips a courier locked mid-accept, expires the offer on the next tick';
end $$;
