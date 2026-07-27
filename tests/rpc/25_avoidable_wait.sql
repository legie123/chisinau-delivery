-- Order 4 (observe-only, no auto-compensation) — AVOIDABLE WAIT. Sims: a
-- partner sees their own restaurant_wait_kpis row with a non-null grace value
-- (the current_avoidable_wait_grace_minutes() phoenix-fix reader), a foreign
-- partner sees nothing for a restaurant they're not staffed at, and the
-- pre-accept prep-time override is honored by accept_order but rejected once
-- the order has already been accepted. Rolled back by runner.

do $$
declare
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003'; -- staffed at Sakura Sushi only
  v_own_restaurant uuid := '11111111-1111-1111-1111-111111111111';
  v_foreign_restaurant uuid := 'd0000000-0000-0000-0000-000000000004'; -- partner NOT staffed here
  v_order uuid := 'e0000000-0000-0000-0000-000000000005'; -- standard order, Sakura
  v_row_count int;
  v_grace int;
  v_override int;
  v_status text;
  v_estimated timestamptz;
  v_raised boolean;
begin
  -- ==== 0. known baseline: force order 5 (standard, Sakura) back to
  --         pending_restaurant so accept_order's estimated_ready_at branch runs
  --         (order 17 is catering — that branch always stays null there). ====
  update public.orders
  set status = 'pending_restaurant', courier_id = null, courier_arrived_restaurant_at = null,
      prep_time_override_minutes = null, estimated_ready_at = null
  where id = v_order;

  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);

  -- ==== 1. partner sees own restaurant's KPI row, grace value non-null ====
  select count(*) into v_row_count from public.restaurant_wait_kpis where restaurant_id = v_own_restaurant;
  if v_row_count <> 1 then raise exception 'FAIL: partner sees % rows for own restaurant (expected 1)', v_row_count; end if;

  select avoidable_wait_grace_minutes into v_grace from public.restaurant_wait_kpis where restaurant_id = v_own_restaurant;
  if v_grace is null then raise exception 'FAIL: avoidable_wait_grace_minutes is NULL for the partner (phoenix fix regressed)'; end if;
  if v_grace <> 5 then raise exception 'FAIL: seeded avoidable_wait_grace_minutes = % (expected default 5)', v_grace; end if;

  -- ==== 2. foreign partner sees nothing for a restaurant they don't staff ====
  select count(*) into v_row_count from public.restaurant_wait_kpis where restaurant_id = v_foreign_restaurant;
  if v_row_count <> 0 then raise exception 'FAIL: partner sees % rows for a restaurant they are not staffed at (expected 0)', v_row_count; end if;

  -- ==== 3. pre-accept override is honored by accept_order ====
  v_override := 42;
  perform public.set_prep_time_estimate(v_order, v_override);
  select prep_time_override_minutes into v_override from public.orders where id = v_order;
  if v_override <> 42 then raise exception 'FAIL: override not stamped (%)', v_override; end if;

  perform public.accept_order(v_order);
  select status, estimated_ready_at into v_status, v_estimated from public.orders where id = v_order;
  if v_status <> 'accepted' then raise exception 'FAIL: order not accepted (%)', v_status; end if;
  if v_estimated is null then raise exception 'FAIL: estimated_ready_at not stamped'; end if;
  if abs(extract(epoch from (v_estimated - now())) - 42 * 60) > 5 then
    raise exception 'FAIL: estimated_ready_at (%) does not reflect the 42-minute override (now=%)', v_estimated, now();
  end if;

  -- ==== 4. prep override REJECTED post-accept (Glovo model — no goalpost moves) ====
  v_raised := false;
  begin perform public.set_prep_time_estimate(v_order, 10); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: prep-time override accepted AFTER accept (post-accept edit must be blocked)'; end if;

  -- override untouched by the rejected attempt
  select prep_time_override_minutes into v_override from public.orders where id = v_order;
  if v_override <> 42 then raise exception 'FAIL: rejected post-accept call still mutated the override (%)', v_override; end if;

  raise notice 'PASS avoidable-wait: partner sees own KPI row with non-null grace, foreign partner sees nothing, pre-accept override honored by accept_order, post-accept override rejected';
end $$;
