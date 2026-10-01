#!/bin/sh
# Runs INSIDE the db container (copied by run.sh). Each check raises on a broken invariant.
set -e
Q="psql -U postgres -q -At -v ON_ERROR_STOP=1 benchdb"
couriers() { $Q -c "select user_id from couriers where is_active"; }

echo "▸ 1/3 claim race"
$Q -c "call bench_arrange()" -c "truncate bench_log" -c "call bench_place(20)" -c "call bench_partner(3)"
$Q -c "update couriers set status='online' where is_active"
ARR=$($Q -c "select array_agg(id order by created_at)::text from orders where status='ready_for_pickup'")
for u in $(couriers); do $Q -c "call bench_claim_all('$u'::uuid, '$ARR'::uuid[])" & done; wait
$Q <<'SQL'
do $$ declare n_ok int; n_c int; n_dup int; n_multi int; begin
  select count(*) into n_ok from bench_log where kind='claim' and ok;
  select count(*) into n_c from couriers where is_active;
  select count(*) into n_dup from (select courier_id from orders where status in ('courier_assigned','picked_up','en_route') group by 1 having count(*)>1) x;
  select count(*) into n_multi from (select order_id from delivery_status_events where status='courier_assigned' and created_at > now()-interval '5 min' group by 1 having count(*)>1) y;
  if n_ok <> n_c or n_dup > 0 or n_multi > 0 then
    raise exception 'FAIL claim race: % wins for % couriers, % double-loaded couriers, % double-assigned orders', n_ok, n_c, n_dup, n_multi; end if;
  raise notice 'PASS claim race: % couriers, % wins, 0 doubles', n_c, n_ok;
end $$;
SQL

echo "▸ 2/3 burst load (60s budget)"
$Q -c "call bench_arrange()" -c "truncate bench_log" -c "update couriers set status='online' where is_active"
T0=$($Q -c "select clock_timestamp()")
for i in 1 2 3 4 5; do $Q -c "call bench_place(30)" & done
$Q -c "call bench_partner(60)" &
$Q -c "call bench_sweeper(60)" &
for u in $(couriers); do $Q -c "call bench_courier('$u'::uuid, 60)" & done
wait
{ echo "set bench.t0 = '$T0';"; cat <<'SQL'
do $$ declare n int; d int; open int; errs int; dbl int; p95 numeric; begin
  select count(*), count(*) filter (where status='delivered'), count(*) filter (where status not in ('delivered','cancelled','rejected'))
    into n, d, open from orders where created_at >= current_setting('bench.t0')::timestamptz;
  select count(*) into errs from bench_log where not ok;
  select count(*) into dbl from (select e.order_id from delivery_status_events e join orders o on o.id=e.order_id
    where o.created_at >= current_setting('bench.t0')::timestamptz and e.status in ('courier_assigned','delivered')
    group by e.order_id, e.status having count(*)>1) x;
  select round(percentile_cont(0.95) within group (order by extract(epoch from delivered_at-created_at))::numeric,1) into p95
    from orders where created_at >= current_setting('bench.t0')::timestamptz and status='delivered';
  if n <> 150 or d <> 150 or open > 0 or errs > 0 or dbl > 0 then
    raise exception 'FAIL burst: placed % delivered % open % errors % duplicate-events %', n, d, open, errs, dbl; end if;
  raise notice 'PASS burst: 150/150 delivered, 0 errors, p95 place->delivered %s', p95;
end $$;
SQL
} | $Q

echo "▸ 3/3 accept-at-expiry race (6 rounds)"
$Q -c "truncate bench_log"
for round in 1 2 3 4 5 6; do
  $Q -c "call bench_arrange()" -c "update couriers set status='online' where is_active" -c "call bench_place(9)" -c "call bench_partner(2)"
  $Q -c "update dispatch_offers set expires_at = clock_timestamp() + interval '400 ms' where status='offered'"
  $Q -c "call bench_sweeper_fast(1200)" &
  for u in $(couriers); do $Q -c "call bench_accept_at_boundary('$u'::uuid)" & done
  wait
done
$Q <<'SQL'
do $$ declare won int; lost int; bad int; viol int; begin
  select count(*) filter (where ok), count(*) filter (where not ok and err = 'oferta a expirat'), count(*) filter (where not ok and err <> 'oferta a expirat')
    into won, lost, bad from bench_log where kind='bacc';
  select count(*) into viol from bench_log where kind='sweep' and not ok;
  select viol + count(*) into viol from orders o where o.status in ('courier_assigned','picked_up','en_route','delivered')
    and exists (select 1 from dispatch_offers d where d.order_id=o.id and d.courier_id<>o.courier_id and d.status in ('offered','accepted'));
  if bad > 0 or viol > 0 then raise exception 'FAIL expiry race: % unexpected accept errors, % sweeper errors/violations', bad, viol; end if;
  raise notice 'PASS expiry race: % accepts won, % cleanly expired, 0 deadlocks', won, lost;
end $$;
SQL
echo "CONCURRENCY: all green"
