-- 20261002000300: the claim RPCs must lock the courier row in a mode compatible with the FK
-- KEY SHARE that dispatch_order's offer insert takes on the candidate courier (it already holds
-- the order) — FOR UPDATE conflicts with it and formed a deadlock cycle with the sweeper.
-- A second psql session holds FOR KEY SHARE on the courier, like an in-flight offer insert;
-- assign_courier must not wait on it. Old body (FOR UPDATE): lock_timeout -> FAIL.

do $$
declare v_cid uuid; v_oid uuid;
begin
  select id into v_cid from public.couriers where user_id = 'c0000000-0000-0000-0000-000000000002';
  update public.orders set status = 'cancelled' where courier_id = v_cid and status in ('courier_assigned','picked_up','en_route');
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_cid, 'offload', -public.courier_cash_balance(v_cid), 'sim baseline reset (rolled back)'
  where public.courier_cash_balance(v_cid) > 0;
  update public.couriers set status = 'online', is_active = true where id = v_cid;
  select id into v_oid from public.orders where status = 'delivered' order by created_at limit 1;
  update public.orders set status = 'ready_for_pickup', courier_id = null where id = v_oid;
  update public.dispatch_offers set status = 'cancelled' where order_id = v_oid and status = 'offered';
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  select v_cid, r.lat, r.lng, now() from public.restaurants r join public.orders o on o.restaurant_id = r.id where o.id = v_oid
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
  perform set_config('sim69.order', v_oid::text, true);
end $$;

\! psql -U postgres -d postgres -qAt -c "/* sim69-lock */ begin; select 1 from public.couriers where user_id = 'c0000000-0000-0000-0000-000000000002' for key share; select pg_sleep(4); commit;" >/dev/null 2>&1 &

do $$
declare i int := 0; v_oid uuid := current_setting('sim69.order')::uuid; v_courier uuid;
begin
  while not exists (select 1 from pg_stat_activity where query like '/* sim69-lock */%' and wait_event = 'PgSleep') loop
    i := i + 1;
    if i > 50 then raise exception 'FAIL: harness - background KEY SHARE session never started'; end if;
    perform pg_sleep(0.1);
    perform pg_stat_clear_snapshot();
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub','c0000000-0000-0000-0000-000000000002','role','authenticated')::text, true);
  perform set_config('lock_timeout', '1500ms', true);
  begin
    perform public.assign_courier(v_oid);
  exception when lock_not_available then
    raise exception 'FAIL: assign_courier waited on a FK KEY SHARE lock (FOR UPDATE on courier -> deadlock cycle with dispatch_order)';
  end;
  select courier_id into v_courier from public.orders where id = v_oid;
  if v_courier is distinct from (select id from public.couriers where user_id = 'c0000000-0000-0000-0000-000000000002') then
    raise exception 'FAIL: claim did not assign the order (courier %)', v_courier;
  end if;
  raise notice 'PASS: assign_courier claims without waiting on an in-flight offer insert (FK KEY SHARE)';
end $$;

select pg_sleep(4.5);
