-- Master-audit Faza 5 #5 — courier_shifts (RPC-only via set_courier_online_status)
-- + courier_satisfaction_surveys (submit_courier_satisfaction) + the
-- admin_courier_pilot_kpis read surface. Rolled back by runner.

do $$
declare
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_customer_user uuid := 'a0000000-0000-0000-0000-000000000001';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier uuid;
  v_raised boolean;
  v_open_count int;
  v_shift_id uuid;
  v_avg numeric;
  v_responses int;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;

  -- Force a known baseline: no open shift, courier offline.
  update public.couriers set status = 'offline' where id = v_courier;
  delete from public.courier_shifts where courier_id = v_courier;
  delete from public.courier_satisfaction_surveys where courier_id = v_courier;

  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);

  -- ---- Shift open/close ----
  perform public.set_courier_online_status('online');
  select count(*) into v_open_count from public.courier_shifts where courier_id = v_courier and ended_at is null;
  if v_open_count <> 1 then raise exception 'FAIL: expected exactly 1 open shift after going online, got %', v_open_count; end if;

  -- Redundant online->online must NOT open a second shift (idempotent no-op).
  perform public.set_courier_online_status('online');
  select count(*) into v_open_count from public.courier_shifts where courier_id = v_courier and ended_at is null;
  if v_open_count <> 1 then raise exception 'FAIL: redundant online toggle opened a second shift (count=%)', v_open_count; end if;

  select id into v_shift_id from public.courier_shifts where courier_id = v_courier and ended_at is null;

  perform public.set_courier_online_status('offline');
  if exists (select 1 from public.courier_shifts where id = v_shift_id and ended_at is null) then
    raise exception 'FAIL: shift still open after going offline';
  end if;
  select count(*) into v_open_count from public.courier_shifts where courier_id = v_courier;
  if v_open_count <> 1 then raise exception 'FAIL: expected exactly 1 shift row total, got %', v_open_count; end if;

  -- ---- Satisfaction survey: range guard ----
  v_raised := false;
  begin perform public.submit_courier_satisfaction(6); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: stars=6 accepted (must be 1-5)'; end if;

  -- ---- Satisfaction: non-courier cannot submit ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer_user,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.submit_courier_satisfaction(5); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a non-courier submitted a satisfaction survey'; end if;

  -- ---- Satisfaction: submit, idempotent retry, immutable on change ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.submit_courier_satisfaction(5, 'saptamana buna');
  perform public.submit_courier_satisfaction(5, 'saptamana buna'); -- identical retry: silent success

  v_raised := false;
  begin perform public.submit_courier_satisfaction(3); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: changed the same week''s stars (must be immutable)'; end if;

  if (select count(*) from public.courier_satisfaction_surveys where courier_id = v_courier) <> 1 then
    raise exception 'FAIL: expected exactly 1 survey row (idempotent retry must not duplicate)';
  end if;

  -- ---- RLS: another courier's account cannot read this courier's rows ----
  -- (`postgres` is superuser/BYPASSRLS — must actually become `authenticated`
  -- for the policies to be evaluated at all; see 03_security_guards.sql.)
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer_user,'role','authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.courier_shifts where courier_id = v_courier) then
    reset role;
    raise exception 'FAIL: non-owner read courier_shifts rows (RLS leak)';
  end if;
  if exists (select 1 from public.courier_satisfaction_surveys where courier_id = v_courier) then
    reset role;
    raise exception 'FAIL: non-owner read courier_satisfaction_surveys rows (RLS leak)';
  end if;
  reset role;

  -- ---- Admin KPI view reflects the submitted survey (under REAL RLS, not superuser bypass) ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  set local role authenticated;
  select satisfaction_avg_4w, satisfaction_responses_4w into v_avg, v_responses
    from public.admin_courier_pilot_kpis where courier_id = v_courier;
  reset role;
  if v_avg is distinct from 5.00 then raise exception 'FAIL: satisfaction_avg_4w = % (expected 5.00)', v_avg; end if;
  if v_responses <> 1 then raise exception 'FAIL: satisfaction_responses_4w = % (expected 1)', v_responses; end if;

  -- ---- Gross-per-shift is actually computed from delivered+paid orders ----
  -- Pin one seed order to a known fee/tip, delivered inside a NARROW synthetic
  -- shift window (13d11h ago — no seed order in this repo lands there, see
  -- rich_demo_*.sql offsets) so nothing else in the courier's real history
  -- leaks into the sum and the expected total is deterministic. delivery_fee_mdl
  -- itself is NOT touched here (order 9's write-once fee-floor trigger — added
  -- 20260727002100 — now blocks any post-insert change to it): the seeded value
  -- for this order (45) is used as-is instead of pinning it to 40.
  update public.orders
  set courier_id = v_courier, status = 'delivered', payment_status = 'paid',
      delivered_at = now() - interval '13 days 11 hours', tip_mdl = 10
  where id = 'e0000000-0000-0000-0000-000000000023';

  -- Clean slate: the earlier open/close test above also left a (real, tiny)
  -- shift inside the 14d window — clear it so only the synthetic one counts.
  delete from public.courier_shifts where courier_id = v_courier;
  insert into public.courier_shifts (courier_id, started_at, ended_at)
  values (v_courier, now() - interval '13 days 12 hours', now() - interval '13 days 10 hours');

  select shifts_14d, median_gross_per_shift_14d into v_open_count, v_avg
    from public.admin_courier_pilot_kpis where courier_id = v_courier;
  if v_open_count <> 1 then raise exception 'FAIL: shifts_14d = % (expected 1 synthetic shift)', v_open_count; end if;
  if v_avg is distinct from 55.00 then
    raise exception 'FAIL: median_gross_per_shift_14d = % (expected 55.00 = 45 seeded fee + 10 tip)', v_avg;
  end if;

  -- ---- Blip shift (0 orders) must count in shifts_14d/empty_shifts_14d but
  -- NOT drag median_gross_per_shift_14d / avg_orders_per_shift_14d down ----
  insert into public.courier_shifts (courier_id, started_at, ended_at)
  values (v_courier, now() - interval '2 days 1 hour', now() - interval '2 days');

  declare
    v_shifts int;
    v_empty int;
    v_median numeric;
    v_avg_orders numeric;
  begin
    select shifts_14d, empty_shifts_14d, median_gross_per_shift_14d, avg_orders_per_shift_14d
      into v_shifts, v_empty, v_median, v_avg_orders
      from public.admin_courier_pilot_kpis where courier_id = v_courier;
    if v_shifts <> 2 then raise exception 'FAIL: shifts_14d = % (expected 2, real + blip)', v_shifts; end if;
    if v_empty <> 1 then raise exception 'FAIL: empty_shifts_14d = % (expected 1 blip shift)', v_empty; end if;
    if v_median is distinct from 55.00 then
      raise exception 'FAIL: median_gross_per_shift_14d = % (expected 55.00 — blip shift must not dilute it)', v_median;
    end if;
    if v_avg_orders is distinct from 1.0 then
      raise exception 'FAIL: avg_orders_per_shift_14d = % (expected 1.0 — blip shift must not dilute it)', v_avg_orders;
    end if;
  end;

  raise notice 'PASS courier-pilot-kpis: shift opens/closes exactly once (idempotent toggle), satisfaction survey range-guarded + courier-only + immutable + idempotent retry, RLS blocks non-owner reads, admin KPI view aggregates correctly, blip (0-order) shifts excluded from median/avg but visible via empty_shifts_14d';
end $$;
