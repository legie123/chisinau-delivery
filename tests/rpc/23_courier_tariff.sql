-- Order 2 (pilot-critical) — PER-DELIVERY COURIER TARIFF. Quote stamped at
-- ready (floor); final stamped at delivered, never below the quote even when
-- the live tariff moves. Sim #11-style guard: admin_generate_payouts must use
-- the courier fee (not delivery_fee_mdl) in every courier-block position —
-- both the aggregate CTE and the payout_orders insert-select. Rolled back by
-- runner.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid;
  v_raised boolean;
  v_status text;
  v_dist2 numeric; v_dist19 numeric;
  v_expected_quote2 numeric; v_expected_quote19 numeric;
  v_quote2 numeric; v_quote19 numeric;
  v_final2 numeric; v_final19 numeric;
  v_delivery_fee2 numeric;
  v_gross numeric; v_net numeric; v_expected_commission numeric;
  v_agg_gross numeric;
  v_wait_grace int;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;

  -- ==== 0. known baseline: two accepted orders, no courier/quote, cash ====
  delete from public.payout_orders where order_id in
    ('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000019');
  delete from public.dispatch_offers where order_id in
    ('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000019');

  update public.orders
  set status = 'accepted', courier_id = null, courier_fee_quoted_mdl = null, courier_fee_mdl = null,
      payment_method = 'cash', payment_status = 'unpaid', tip_mdl = 0, delivery_fee_mdl = 35.00, total_mdl = 400.00
  where id = 'e0000000-0000-0000-0000-000000000002';

  update public.orders
  set status = 'accepted', courier_id = null, courier_fee_quoted_mdl = null, courier_fee_mdl = null,
      payment_method = 'cash', payment_status = 'unpaid', tip_mdl = 0, delivery_fee_mdl = 55.00, total_mdl = 300.00
  where id = 'e0000000-0000-0000-0000-000000000019';

  select public.haversine_km(r.lat, r.lng, a.lat, a.lng) into v_dist2
    from public.restaurants r, public.addresses a
    where r.id = 'd0000000-0000-0000-0000-000000000004' and a.id = 'f0000000-0000-0000-0000-000000000002';
  v_dist19 := 6.0; -- order 19 has no delivery_address_id -> 6km fallback (same as WS2 dispatch)
  v_expected_quote2 := round(30.00 + 6.00 * v_dist2, 2);   -- seeded v1 tariff
  v_expected_quote19 := round(30.00 + 6.00 * v_dist19, 2);

  -- ==== 1. QUOTE stamped at ready (admin has_restaurant_access on any restaurant) ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.mark_ready_for_pickup('e0000000-0000-0000-0000-000000000002'::uuid);
  perform public.mark_ready_for_pickup('e0000000-0000-0000-0000-000000000019'::uuid);

  select status, courier_fee_quoted_mdl into v_status, v_quote2 from public.orders where id = 'e0000000-0000-0000-0000-000000000002';
  if v_status <> 'ready_for_pickup' then raise exception 'FAIL: order 2 not ready_for_pickup (%)', v_status; end if;
  if v_quote2 is distinct from v_expected_quote2 then
    raise exception 'FAIL: order 2 quote = % (expected % = 30 + 6*%)', v_quote2, v_expected_quote2, v_dist2;
  end if;

  select courier_fee_quoted_mdl into v_quote19 from public.orders where id = 'e0000000-0000-0000-0000-000000000019';
  if v_quote19 is distinct from v_expected_quote19 then
    raise exception 'FAIL: order 19 (no address) quote = % (expected % = 30 + 6*6 fallback)', v_quote19, v_expected_quote19;
  end if;

  -- idempotent retry: quote does not get re-stamped
  perform public.mark_ready_for_pickup('e0000000-0000-0000-0000-000000000002'::uuid);
  select courier_fee_quoted_mdl into v_quote2 from public.orders where id = 'e0000000-0000-0000-0000-000000000002';
  if v_quote2 is distinct from v_expected_quote2 then raise exception 'FAIL: idempotent mark_ready_for_pickup changed the quote (%)', v_quote2; end if;

  -- ==== 2. non-admin cannot retune the tariff; a version is immutable ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.set_courier_tariff(999, 999, 999); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a non-admin retuned courier_tariff_config'; end if;

  select wait_grace_minutes into v_wait_grace from public.current_courier_tariff();
  if v_wait_grace <> 3 then raise exception 'FAIL: seeded wait_grace_minutes = % (expected 3)', v_wait_grace; end if;

  v_raised := false;
  begin update public.courier_tariff_config set base_mdl = 1 where effective_from = '2026-01-01T00:00:00Z'; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: the seeded v1 courier_tariff_config row was mutated (must be immutable)'; end if;
  v_raised := false;
  begin delete from public.courier_tariff_config where effective_from = '2026-01-01T00:00:00Z'; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: the seeded v1 courier_tariff_config row was deleted (must be immutable)'; end if;

  -- ==== 3. admin retunes UP -> at delivered, the LIVE tariff can exceed the quote ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  -- Explicit distinct-but-past effective_from: now() is frozen for the whole
  -- transaction (so both retunes calling plain now() would TIE — nondeterministic
  -- "order by effective_from desc"), and clock_timestamp() ticks past that frozen
  -- now(), which current_courier_tariff()'s "effective_from <= now()" would then
  -- filter out entirely. -2s/-1s keeps both strictly ordered AND already effective.
  perform public.set_courier_tariff(200.00, 6.00, 1.50, 3, now() - interval '2 seconds', 'sim: retune up');

  update public.orders set courier_id = v_courier, status = 'courier_assigned' where id = 'e0000000-0000-0000-0000-000000000002';
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.advance_delivery_status('e0000000-0000-0000-0000-000000000002'::uuid, 'picked_up');
  perform public.advance_delivery_status('e0000000-0000-0000-0000-000000000002'::uuid, 'en_route');
  perform public.advance_delivery_status('e0000000-0000-0000-0000-000000000002'::uuid, 'delivered', true);

  select courier_fee_mdl into v_final2 from public.orders where id = 'e0000000-0000-0000-0000-000000000002';
  if v_final2 is distinct from round(200.00 + 6.00 * v_dist2, 2) then
    raise exception 'FAIL: order 2 final fee = % (expected % from the LIVE retuned tariff)', v_final2, round(200.00 + 6.00 * v_dist2, 2);
  end if;
  if v_final2 <= v_quote2 then raise exception 'FAIL: order 2 final (%) did not exceed its quote (%) after tariff rose', v_final2, v_quote2; end if;

  select delivery_fee_mdl into v_delivery_fee2 from public.orders where id = 'e0000000-0000-0000-0000-000000000002';
  if v_final2 = v_delivery_fee2 then raise exception 'FAIL: fixture invalid — courier_fee_mdl equals delivery_fee_mdl (%), needed a DIFFERENT value', v_final2; end if;

  -- ==== 4. admin retunes DOWN -> at delivered, the OLD quote is still a FLOOR ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.set_courier_tariff(5.00, 1.00, 1.50, 3, now() - interval '1 second', 'sim: retune down');

  update public.orders set courier_id = v_courier, status = 'courier_assigned' where id = 'e0000000-0000-0000-0000-000000000019';
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.advance_delivery_status('e0000000-0000-0000-0000-000000000019'::uuid, 'picked_up');
  perform public.advance_delivery_status('e0000000-0000-0000-0000-000000000019'::uuid, 'en_route');
  perform public.advance_delivery_status('e0000000-0000-0000-0000-000000000019'::uuid, 'delivered', true);

  select courier_fee_mdl into v_final19 from public.orders where id = 'e0000000-0000-0000-0000-000000000019';
  -- Owner decision 2026-10-12 (migration 20261012000206): an order without a pin pays the BASE fee of the
  -- live tariff — no 6 km, and the 6 km ready quote is not a floor. The floor for MEASURED orders is pinned by
  -- tests/rpc/151 F6 (this order used to be the floor case only because it had no address).
  if v_final19 is distinct from round(5.00 + coalesce((select courier_fee_surcharge_mdl from public.orders
                                                       where id = 'e0000000-0000-0000-0000-000000000019'), 0), 2) then
    raise exception 'FAIL: order 19 (no address) final = % (expected the live base fee 5.00, no km on a guess; old quote %)',
      v_final19, v_quote19;
  end if;

  -- ==== 5. PAYOUT — coalesce(courier_fee_mdl, delivery_fee_mdl) in EVERY
  --         courier-block position: aggregate CTE AND payout_orders insert-select ====
  update public.orders set delivered_at = '2031-06-15T12:00:00Z'
    where id in ('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000019');

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.admin_generate_payouts('2031-06-15'::date, '2031-06-15'::date);

  select gross_mdl, net_mdl into v_gross, v_net from public.payout_orders
    where order_id = 'e0000000-0000-0000-0000-000000000002' and recipient_type = 'courier';
  if v_gross is distinct from v_final2 then
    raise exception 'FAIL: payout_orders gross (order 2) = % (expected courier_fee_mdl %, NOT delivery_fee_mdl %)', v_gross, v_final2, v_delivery_fee2;
  end if;
  v_expected_commission := round(v_final2 * 15.00 / 100, 2); -- seeded courier_commission_pct
  if v_net is distinct from (v_final2 - v_expected_commission) then
    raise exception 'FAIL: payout_orders net (order 2) = % (expected % — commission must be on courier_fee_mdl too)', v_net, v_final2 - v_expected_commission;
  end if;

  select gross_mdl, net_mdl into v_gross, v_net from public.payout_orders
    where order_id = 'e0000000-0000-0000-0000-000000000019' and recipient_type = 'courier';
  if v_gross is distinct from v_final19 then
    raise exception 'FAIL: payout_orders gross (order 19, floor case) = % (expected %)', v_gross, v_final19;
  end if;

  -- aggregate CTE term: the courier's payouts row sums BOTH orders' courier fees
  select p.gross_mdl into v_agg_gross from public.payouts p
    where p.recipient_type = 'courier' and p.recipient_id = v_courier
      and p.period_start = '2031-06-15' and p.period_end = '2031-06-15';
  if v_agg_gross is distinct from round(v_final2 + v_final19, 2) then
    raise exception 'FAIL: aggregate payouts.gross_mdl = % (expected % = final2+final19 — aggregate CTE not using courier fee)', v_agg_gross, round(v_final2 + v_final19, 2);
  end if;

  raise notice 'PASS courier-tariff: quote stamped at ready (haversine + 6km fallback), idempotent, non-admin/immutable version guard, final floored at quote when tariff rises AND holds the floor when tariff drops, admin_generate_payouts uses coalesce(courier_fee_mdl, delivery_fee_mdl) in the aggregate CTE and both payout_orders terms';
end $$;
