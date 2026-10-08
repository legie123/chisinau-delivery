-- Tip cap (migration 20261008000100_tip_cap): set_order_tip rejects a tip above
-- min(food value, pricing_config.tip_max_mdl). Food value = subtotal (standard) or
-- total − fee − tip (catering, the confirmed quote) — the repo's money definition.
-- Before the fix any tip was accepted: a cash order could be inflated to any total
-- and the courier would be told to collect it.
-- T4 documents (does not change) how a capped tip meets the courier float cap.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_rest uuid; v_courier uuid; v_oid uuid; v_total numeric; v_tip numeric; v_err text; v_coll numeric; v_cap numeric;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select id into v_courier from public.couriers where user_id = c_courier_user;

  -- ===== T1: standard, subtotal 200 → cap 200 =====
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl)
  values ('standard', c_cust, v_rest, 'accepted', 'cash', 'unpaid', 200, 30, 230, 0)
  returning id into v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  v_err := null;
  begin
    perform public.set_order_tip(v_oid, 201);
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL 84.T1: tip 201 accepted on a 200 MDL subtotal'; end if;
  if v_err not like '%bacșiș%' then raise exception 'FAIL 84.T1: refusal not in Romanian: %', v_err; end if;
  perform public.set_order_tip(v_oid, 200);
  select total_mdl, tip_mdl into v_total, v_tip from public.orders where id = v_oid;
  if v_tip <> 200 or v_total <> 430 then raise exception 'FAIL 84.T1: tip at the cap refused (tip %, total %)', v_tip, v_total; end if;
  raise notice 'PASS 84.T1: tip capped at the subtotal (201 refused: %; 200 accepted)', v_err;

  -- ===== T2: standard, subtotal 1200 → cap 500 (absolute) =====
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl)
  values ('standard', c_cust, v_rest, 'accepted', 'card_on_delivery', 'unpaid', 1200, 30, 1230, 0)
  returning id into v_oid;
  v_err := null;
  begin
    perform public.set_order_tip(v_oid, 500.01);
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL 84.T2: tip 500.01 accepted (absolute cap 500)'; end if;
  perform public.set_order_tip(v_oid, 500);
  select total_mdl into v_total from public.orders where id = v_oid;
  if v_total <> 1730 then raise exception 'FAIL 84.T2: total % after a 500 tip (expected 1730)', v_total; end if;
  raise notice 'PASS 84.T2: absolute cap 500 MDL holds on a large order';

  -- ===== T3: catering — the cap base is the confirmed quote, not the tiny menu subtotal =====
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl)
  values ('catering', c_cust, v_rest, 'accepted', 'cash', 'unpaid', 200, 0, 5000, 0)
  returning id into v_oid;
  perform public.set_order_tip(v_oid, 400);   -- > subtotal 200, < quote 5000, < 500
  perform public.set_order_tip(v_oid, 450);   -- replacing a tip: base excludes the current tip
  select total_mdl into v_total from public.orders where id = v_oid;
  if v_total <> 5450 then raise exception 'FAIL 84.T3: catering total % (expected 5450)', v_total; end if;
  v_err := null;
  begin
    perform public.set_order_tip(v_oid, 600);
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL 84.T3: catering tip 600 accepted'; end if;
  raise notice 'PASS 84.T3: catering cap on the quoted food value, 500 ceiling';

  -- ===== T4 (documentation): a capped tip still rides into the courier's cash float =====
  -- advance_delivery_status books collected = total_mdl (tip included). place_order's
  -- 1400 MDL cash checkout cap counts subtotal + fee only, so the largest cash total a
  -- courier can be handed is 1400 + 500 = 1900 MDL — above the 1500 float cap. The float
  -- cap is enforced on the NEXT offer (courier_has_capacity) and by the accrual trigger
  -- (forced offline), never by refusing the handover. Before this fix the overshoot was
  -- unbounded (any tip).
  perform set_config('request.jwt.claims', null, true);
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_courier, 'refund_reversal', -public.courier_cash_balance(v_courier), 'sim baseline zero (rolled back)'
  where public.courier_cash_balance(v_courier) > 0;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl, courier_id)
  values ('standard', c_cust, v_rest, 'en_route', 'cash', 'unpaid', 1370, 30, 1400, 0, v_courier)
  returning id into v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  perform public.set_order_tip(v_oid, 500);
  perform set_config('request.jwt.claims', json_build_object('sub', c_courier_user, 'role', 'authenticated')::text, true);
  perform public.advance_delivery_status(v_oid, 'delivered', true);
  perform set_config('request.jwt.claims', null, true);
  select amount_mdl into v_coll from public.courier_cash_movements where order_id = v_oid and kind = 'collected';
  v_cap := public.effective_cash_cap(v_courier);
  if v_coll is distinct from 1900 then raise exception 'FAIL 84.T4: collected % (expected 1900 = 1400 + capped tip)', v_coll; end if;
  if public.courier_has_capacity(v_courier) then
    raise exception 'FAIL 84.T4: courier still has capacity at float % over cap %', public.courier_cash_balance(v_courier), v_cap;
  end if;
  raise notice 'PASS 84.T4: max cash handover = 1900 MDL (float cap %): courier collects it, then gets no new offer until offload', v_cap;

  -- ===== T5: the ceiling is versioned config (pricing_config), not a literal =====
  insert into public.pricing_config (effective_from, courier_commission_pct, restaurant_commission_pct, tip_max_mdl, note)
  select now(), courier_commission_pct, restaurant_commission_pct, 300, 'sim 84 (rolled back)' from public.current_pricing_config();
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, tip_mdl)
  values ('standard', c_cust, v_rest, 'accepted', 'cash', 'unpaid', 1200, 30, 1230, 0)
  returning id into v_oid;
  v_err := null;
  begin
    perform public.set_order_tip(v_oid, 301);
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL 84.T5: a new pricing_config version (tip_max 300) was ignored'; end if;
  -- set_pricing_config carries the ceiling over (a commission change must not reset it)
  perform set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
  if not public.has_role('platform_admin') then raise exception 'FAIL 84.T5: fixture a...04 is not platform_admin'; end if;
  perform public.set_pricing_config(16, 20, now() + interval '1 second', 'sim 84 (rolled back)');
  if (select tip_max_mdl from public.pricing_config_at(now() + interval '2 seconds')) <> 300 then
    raise exception 'FAIL 84.T5: set_pricing_config reset tip_max_mdl to %', (select tip_max_mdl from public.pricing_config_at(now() + interval '2 seconds'));
  end if;
  raise notice 'PASS 84.T5: ceiling read from the current pricing_config version and carried over by set_pricing_config';
end $$;
