-- MARELE AUDIT 2026-08-03 — RestPartnerAudit #1 (CRIT).
-- Proves the expanded guard_restaurant_platform_columns (20260803000000):
-- a restaurant partner, writing directly to their OWN restaurant row as the
-- non-bypassrls `authenticated` role (exactly what a Supabase REST UPDATE with
-- the partner's session does), can NO LONGER move the money-/dispatch-critical
-- columns, while the genuine self-service column (accepting_orders) still moves.
--
-- The runner wraps this in BEGIN;...ROLLBACK; and connects as postgres
-- (BYPASSRLS). We `set local role authenticated` + request.jwt.claims to become
-- the partner for the write, then reset to read back the truth. Without the
-- guard, delivery_fee_mdl WOULD change (verified pre-fix via pg_policy: the
-- policy has no column scope) — the assertions below are what the fix buys.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111'; -- Sakura Sushi
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003'; -- staff of v_rest
  old_fee numeric; old_min numeric; old_cat_min numeric;
  old_sla int; old_prep int; old_lat numeric; old_lng numeric;
  old_accepting boolean; old_name text;
  new_fee numeric; new_min numeric; new_cat_min numeric;
  new_sla int; new_prep int; new_lat numeric; new_lng numeric;
  new_accepting boolean; new_name text;
begin
  select delivery_fee_mdl, min_order_amount_mdl, catering_min_amount_mdl,
         accept_sla_minutes, avg_prep_minutes, lat, lng, accepting_orders, name
    into old_fee, old_min, old_cat_min, old_sla, old_prep, old_lat, old_lng,
         old_accepting, old_name
    from public.restaurants where id = v_rest;

  -- Become the partner (non-bypassrls role + JWT claims), like a REST call.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);

  -- The attack: rewrite every locked column + flip one legit self-service one.
  update public.restaurants set
    delivery_fee_mdl        = 99999,
    min_order_amount_mdl    = 0,
    catering_min_amount_mdl = 0,
    accept_sla_minutes      = 99999,
    avg_prep_minutes        = 1,
    lat                     = 0,
    lng                     = 0,
    accepting_orders        = not old_accepting  -- legit toggle, must succeed
  where id = v_rest;

  -- Back to the truth.
  reset role;
  perform set_config('request.jwt.claims', null, true);

  select delivery_fee_mdl, min_order_amount_mdl, catering_min_amount_mdl,
         accept_sla_minutes, avg_prep_minutes, lat, lng, accepting_orders, name
    into new_fee, new_min, new_cat_min, new_sla, new_prep, new_lat, new_lng,
         new_accepting, new_name
    from public.restaurants where id = v_rest;

  -- Locked columns must be untouched.
  if new_fee     is distinct from old_fee     then raise exception 'FAIL: partner moved delivery_fee_mdl %→%', old_fee, new_fee; end if;
  if new_min     is distinct from old_min     then raise exception 'FAIL: partner moved min_order_amount_mdl %→%', old_min, new_min; end if;
  if new_cat_min is distinct from old_cat_min then raise exception 'FAIL: partner moved catering_min_amount_mdl %→%', old_cat_min, new_cat_min; end if;
  if new_sla     is distinct from old_sla     then raise exception 'FAIL: partner moved accept_sla_minutes %→%', old_sla, new_sla; end if;
  if new_prep    is distinct from old_prep    then raise exception 'FAIL: partner moved avg_prep_minutes %→%', old_prep, new_prep; end if;
  if new_lat     is distinct from old_lat     then raise exception 'FAIL: partner moved lat %→%', old_lat, new_lat; end if;
  if new_lng     is distinct from old_lng     then raise exception 'FAIL: partner moved lng %→%', old_lng, new_lng; end if;

  -- Self-service column must have moved (guard is not over-locking).
  if new_accepting is not distinct from old_accepting then
    raise exception 'FAIL: guard over-locked accepting_orders (partner self-service broke)';
  end if;

  raise notice 'PASS: partner column guard — money/SLA/geo locked, accepting_orders still writable';
end $$;
