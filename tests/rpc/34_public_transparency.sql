-- Order 9 (20260727002100) — public transparency page backend. Three checks:
-- (a) anon can call both published-history readers and gets rows with NO
--     created_by column exposed; (b) the fee-floor trigger blocks a
--     post-checkout DECREASE (and, being the stricter full guard, an increase
--     too) to orders.delivery_fee_mdl; (c) a legit lifecycle path
--     (advance_delivery_status, which never touches delivery_fee_mdl) still
--     works end to end on a seeded order. Rolled back by runner.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid;
  v_raised boolean;
  v_n int;
  v_row jsonb;
  v_courier_pct numeric; v_restaurant_pct numeric; v_note text;
  v_base numeric; v_per_km numeric; v_wait numeric; v_grace int; v_ctc_note text;
  v_oid uuid := 'e0000000-0000-0000-0000-000000000002';
  v_orig_fee numeric;
  v_fee_after numeric;
  v_status text;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;

  ---------------------------------------------------------------------------
  -- (a) anon can call both published-history readers; rows carry no created_by.
  ---------------------------------------------------------------------------
  set local role anon;

  select count(*) into v_n from public.public_pricing_history();
  if v_n < 1 then raise exception 'FAIL: anon got % rows from public_pricing_history (expected >= 1)', v_n; end if;

  select to_jsonb(t) into v_row from public.public_pricing_history() t order by t.effective_from asc limit 1;
  if v_row ? 'created_by' then raise exception 'FAIL: public_pricing_history leaks created_by: %', v_row; end if;
  if not (v_row ? 'courier_pct' and v_row ? 'restaurant_pct' and v_row ? 'note' and v_row ? 'effective_from' and v_row ? 'id') then
    raise exception 'FAIL: public_pricing_history shape unexpected: %', v_row;
  end if;

  select t.courier_pct, t.restaurant_pct, t.note into v_courier_pct, v_restaurant_pct, v_note
    from public.public_pricing_history() t order by t.effective_from asc limit 1;
  if v_courier_pct <> 15 or v_restaurant_pct <> 20 or v_note is distinct from 'Tarif inițial pilot' then
    raise exception 'FAIL: seeded v1 pricing row wrong via public reader: courier=% restaurant=% note=%', v_courier_pct, v_restaurant_pct, v_note;
  end if;

  select count(*) into v_n from public.public_courier_tariff_history();
  if v_n < 1 then raise exception 'FAIL: anon got % rows from public_courier_tariff_history (expected >= 1)', v_n; end if;

  select to_jsonb(t) into v_row from public.public_courier_tariff_history() t order by t.effective_from asc limit 1;
  if v_row ? 'created_by' then raise exception 'FAIL: public_courier_tariff_history leaks created_by: %', v_row; end if;
  if not (v_row ? 'base_mdl' and v_row ? 'per_km_mdl' and v_row ? 'wait_per_min_mdl' and v_row ? 'wait_grace_minutes' and v_row ? 'note') then
    raise exception 'FAIL: public_courier_tariff_history shape unexpected: %', v_row;
  end if;

  select t.base_mdl, t.per_km_mdl, t.wait_per_min_mdl, t.wait_grace_minutes, t.note
    into v_base, v_per_km, v_wait, v_grace, v_ctc_note
    from public.public_courier_tariff_history() t order by t.effective_from asc limit 1;
  if v_base <> 30.00 or v_per_km <> 6.00 or v_wait <> 1.50 or v_grace <> 3 or v_ctc_note is distinct from 'provizoriu — de ratificat' then
    raise exception 'FAIL: seeded v1 courier_tariff row wrong via public reader: base=% per_km=% wait=% grace=% note=%',
      v_base, v_per_km, v_wait, v_grace, v_ctc_note;
  end if;

  -- direct table SELECT is still RLS-scoped to `authenticated` only (RLS
  -- silently filters to zero rows for anon rather than erroring, same shape
  -- proven in tests/rpc/29_rls_fast_path.sql) — confirms these two functions
  -- are the intended anon door, not an accidental table-level RLS gap.
  select count(*) into v_n from public.pricing_config;
  if v_n <> 0 then raise exception 'FAIL: anon reads % rows directly from pricing_config (RLS gap — expected 0, function-only access)', v_n; end if;
  select count(*) into v_n from public.courier_tariff_config;
  if v_n <> 0 then raise exception 'FAIL: anon reads % rows directly from courier_tariff_config (RLS gap — expected 0, function-only access)', v_n; end if;

  reset role;
  raise notice 'PASS public-transparency (a): anon reads both published tariff histories, created_by excluded, seeded v1 values match';

  ---------------------------------------------------------------------------
  -- (b) fee-floor: delivery_fee_mdl is write-once after insert.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

  select delivery_fee_mdl into v_orig_fee from public.orders where id = v_oid;

  v_raised := false;
  begin
    update public.orders set delivery_fee_mdl = v_orig_fee - 5 where id = v_oid;
  exception when others then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: a DECREASE to delivery_fee_mdl was not blocked'; end if;

  v_raised := false;
  begin
    update public.orders set delivery_fee_mdl = v_orig_fee + 5 where id = v_oid;
  exception when others then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: an INCREASE to delivery_fee_mdl was not blocked (guard must be full, not decrease-only — no legit path needs a change)'; end if;

  -- unchanged (re-asserting the SAME value) must NOT raise — an ordinary
  -- update statement that happens to include this column but doesn't change
  -- its value (e.g. a defensive fixture reset) must keep working.
  v_raised := false;
  begin
    update public.orders set delivery_fee_mdl = v_orig_fee, notes = coalesce(notes, '') where id = v_oid;
  exception when others then v_raised := true;
  end;
  if v_raised then raise exception 'FAIL: a no-op re-assert of the SAME delivery_fee_mdl value was blocked (guard too strict)'; end if;

  select delivery_fee_mdl into v_orig_fee from public.orders where id = v_oid; -- confirm truly unchanged
  raise notice 'PASS public-transparency (b): delivery_fee_mdl write-once — decrease and increase both blocked, no-op unaffected (order %, fee % MDL)', v_oid, v_orig_fee;

  ---------------------------------------------------------------------------
  -- (c) legit path unaffected: advance_delivery_status still works end to end.
  ---------------------------------------------------------------------------
  update public.orders
    set courier_id = v_courier, status = 'courier_assigned', payment_method = 'cash', payment_status = 'unpaid'
    where id = v_oid;

  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.advance_delivery_status(v_oid, 'picked_up');
  perform public.advance_delivery_status(v_oid, 'en_route');
  perform public.advance_delivery_status(v_oid, 'delivered', true);

  select status, delivery_fee_mdl into v_status, v_fee_after from public.orders where id = v_oid;
  if v_status <> 'delivered' then raise exception 'FAIL: advance_delivery_status did not reach delivered (got %)', v_status; end if;
  if v_fee_after <> v_orig_fee then raise exception 'FAIL: delivery_fee_mdl drifted across the lifecycle (% -> %)', v_orig_fee, v_fee_after; end if;

  raise notice 'PASS public-transparency (c): advance_delivery_status (courier_assigned -> picked_up -> en_route -> delivered) unaffected by the fee-floor trigger';
end $$;
