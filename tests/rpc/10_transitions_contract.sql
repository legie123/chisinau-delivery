-- CONTRACT TEST: the TypeScript ADVANCE_TRANSITIONS map (packages/shared-types)
-- must equal the REAL advance_delivery_status behavior. This half exhaustively
-- probes every (from, to) status pair through the actual RPC and asserts the
-- derived allowed-map equals the embedded literal. tests/unit/transitions.test.ts
-- asserts the TS map serializes to the SAME literal. Transitively: TS == RPC.
-- (This is the mechanism that stops the doc/code drift which twice cost stale
-- known-issues — the transition map can no longer silently diverge.)
do $$
declare
  v_statuses text[] := array['pending_restaurant','accepted','ready_for_pickup','courier_assigned','picked_up','en_route','delivered','cancelled','rejected'];
  v_from text; v_to text;
  v_rest uuid; v_cust uuid := 'a0000000-0000-0000-0000-000000000001'; v_courier uuid := 'c9a68659-0734-413e-95d0-87cd21f4a0f7';
  v_oid uuid; v_allowed jsonb := '{}'::jsonb; v_list text[]; v_ok boolean;
  -- canonical literal (sorted keys) — MUST match serializeAdvanceTransitions() in TS
  v_expected jsonb := '{"accepted":[],"cancelled":[],"courier_assigned":["picked_up"],"delivered":[],"en_route":["delivered"],"pending_restaurant":[],"picked_up":["en_route"],"ready_for_pickup":[],"rejected":[]}'::jsonb;
begin
  select id into v_rest from public.restaurants where is_active limit 1;

  foreach v_from in array v_statuses loop
    v_list := array[]::text[];
    foreach v_to in array v_statuses loop
      if v_from = v_to then continue; end if; -- same-status is an idempotent no-op, not a transition

      -- a fresh cash order forced into `v_from`, with a courier + paid so only the
      -- transition matrix (not the money gate / authz) decides the outcome.
      insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                                 subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, delivered_at)
      values ('standard', v_cust, v_rest, v_from, 'cash', 'paid', 100, 20, 120, v_courier,
              case when v_from = 'delivered' then now() else null end)
      returning id into v_oid;

      v_ok := true;
      begin
        -- admin caller: has_role(platform_admin) bypasses the courier check, isolating the matrix
        perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
        perform public.advance_delivery_status(v_oid, v_to, true);
      exception when others then v_ok := false;
      end;
      perform set_config('request.jwt.claims', '', true);
      -- undo any successful transition so the next probe starts clean (all rolled back at the end anyway)
      delete from public.orders where id = v_oid;

      if v_ok then v_list := array_append(v_list, v_to); end if;
    end loop;
    v_allowed := v_allowed || jsonb_build_object(v_from, to_jsonb(v_list));
  end loop;

  if v_allowed <> v_expected then
    raise exception 'FAIL: advance_delivery_status matrix drifted from the TS map. Actual: % Expected: %', v_allowed::text, v_expected::text;
  end if;
  raise notice 'PASS transitions-contract: advance_delivery_status matrix == TS ADVANCE_TRANSITIONS literal (all 72 pairs probed)';
end $$;
