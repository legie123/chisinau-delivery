-- Order 3 (observe-only, no auto-compensation) — ARRIVAL CLOCK. Sims: wrong
-- courier is blocked, the assigned courier's arrival is idempotent (a stale
-- manually-set timestamp proves the guard, since now() is frozen for the
-- whole transaction and a naive "always overwrite" bug would be invisible
-- otherwise), and admin_reassign_courier NULLs the clock for the rescuer.
-- Rolled back by runner.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002'; -- assigned courier
  v_wrong_user uuid := 'c0000000-0000-0000-0000-000000000002';   -- NOT assigned to this order
  v_courier uuid;
  v_new_courier uuid := 'c1000000-0000-0000-0000-000000000001';  -- active, idle, has capacity
  v_raised boolean;
  v_arrived timestamptz;
  v_status text;
  v_stale timestamptz := now() - interval '45 minutes';
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;

  -- ==== 0. known baseline: order e...005 (Sakura), assigned to the test courier ====
  update public.orders
  set status = 'courier_assigned', courier_id = v_courier, courier_arrived_restaurant_at = null
  where id = 'e0000000-0000-0000-0000-000000000005';

  -- ==== 1. a courier NOT assigned to the order cannot stamp arrival ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_wrong_user,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.courier_arrived_at_restaurant('e0000000-0000-0000-0000-000000000005'::uuid);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a non-assigned courier stamped the arrival clock'; end if;

  select courier_arrived_restaurant_at into v_arrived from public.orders where id = 'e0000000-0000-0000-0000-000000000005';
  if v_arrived is not null then raise exception 'FAIL: the blocked call still wrote a timestamp'; end if;

  -- ==== 2. wrong status guard: not allowed once picked up ====
  update public.orders set status = 'picked_up' where id = 'e0000000-0000-0000-0000-000000000005';
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.courier_arrived_at_restaurant('e0000000-0000-0000-0000-000000000005'::uuid);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: arrival accepted outside status=courier_assigned'; end if;
  update public.orders set status = 'courier_assigned' where id = 'e0000000-0000-0000-0000-000000000005';

  -- ==== 3. the assigned courier stamps arrival ====
  perform public.courier_arrived_at_restaurant('e0000000-0000-0000-0000-000000000005'::uuid);
  select courier_arrived_restaurant_at into v_arrived from public.orders where id = 'e0000000-0000-0000-0000-000000000005';
  if v_arrived is null then raise exception 'FAIL: arrival was not stamped'; end if;

  -- ==== 4. idempotency: force a distinct STALE value directly (bypassing the
  --         RPC), then call again — a broken (non-idempotent) implementation
  --         would overwrite it with now(); the guard must leave it untouched. ====
  update public.orders set courier_arrived_restaurant_at = v_stale where id = 'e0000000-0000-0000-0000-000000000005';
  perform public.courier_arrived_at_restaurant('e0000000-0000-0000-0000-000000000005'::uuid);
  select courier_arrived_restaurant_at into v_arrived from public.orders where id = 'e0000000-0000-0000-0000-000000000005';
  if v_arrived is distinct from v_stale then
    raise exception 'FAIL: idempotency broken — arrival clock changed from % to % on a retry', v_stale, v_arrived;
  end if;

  -- ==== 5. admin_reassign_courier NULLs the clock for the rescuing courier ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.admin_reassign_courier('e0000000-0000-0000-0000-000000000005'::uuid, v_new_courier);

  select status, courier_id, courier_arrived_restaurant_at into v_status, v_courier, v_arrived
    from public.orders where id = 'e0000000-0000-0000-0000-000000000005';
  if v_status <> 'courier_assigned' then raise exception 'FAIL: reassigned order status = % (expected courier_assigned)', v_status; end if;
  if v_courier <> v_new_courier then raise exception 'FAIL: reassigned order courier_id not the new courier'; end if;
  if v_arrived is not null then
    raise exception 'FAIL: courier_arrived_restaurant_at still % after reassign (must be NULL for the rescuer)', v_arrived;
  end if;

  -- the new courier's own arrival call now works (clock genuinely reset, not just locked out)
  perform set_config('request.jwt.claims', json_build_object('sub', (select user_id from public.couriers where id = v_new_courier),'role','authenticated')::text, true);
  perform public.courier_arrived_at_restaurant('e0000000-0000-0000-0000-000000000005'::uuid);
  select courier_arrived_restaurant_at into v_arrived from public.orders where id = 'e0000000-0000-0000-0000-000000000005';
  if v_arrived is null then raise exception 'FAIL: rescuing courier could not stamp arrival after reassign'; end if;

  raise notice 'PASS arrival-clock: wrong courier blocked, status-guarded, idempotent against a stale manual value, admin_reassign_courier NULLs the clock and the rescuer can stamp their own arrival';
end $$;
