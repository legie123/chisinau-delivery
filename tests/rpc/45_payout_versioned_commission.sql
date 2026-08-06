-- MARELE AUDIT 2026-08-03 — MoneySectorAudit #1 (P0).
-- Proves admin_generate_payouts charges the commission version in EFFECT AT
-- DELIVERY, not the current (mutable) platform_settings cache. Scenario: an
-- order delivered while commission was the seeded 20%/15%; commission is then
-- HIKED (effective after delivery) and the cache overwritten to match — exactly
-- the drift the unpatched code picked up. The payout must still use the
-- delivery-era rate. Runner wraps in BEGIN/ROLLBACK as postgres; admin auth via
-- jwt claims (admin_generate_payouts is SECURITY DEFINER + has_role gate).

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_cust  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_courier uuid;
  v_a uuid; v_b uuid;
  v_t1 timestamptz := date_trunc('month', now()) + interval '1 day';
  v_net_rest numeric; v_net_courier numeric;
begin
  select id into v_rest from public.restaurants where is_active order by name desc limit 1;
  select id into v_courier from public.couriers limit 1;

  -- A: restaurant order delivered at T1 (seeded restaurant commission = 20%).
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, delivered_at)
  values ('standard', v_cust, v_rest, 'delivered', 'cash', 'paid', 1000, 20, 1020, v_t1)
  returning id into v_a;

  -- B: courier order delivered at T1 (seeded courier commission = 15%), fee 50.
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', v_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 300, 20, 50, 320, v_t1)
  returning id into v_b;

  -- Commission HIKED after delivery (effective T1 + 1h) AND the cache overwritten.
  insert into public.pricing_config (effective_from, courier_commission_pct, restaurant_commission_pct, note)
  values (v_t1 + interval '1 hour', 40, 50, 'sim: post-delivery hike');
  update public.platform_settings set restaurant_commission_pct = 50, courier_commission_pct = 40 where id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_generate_payouts(date_trunc('month', now())::date,
                                        (date_trunc('month', now()) + interval '1 month - 1 day')::date);

  -- Restaurant: 20% of 1000 => commission 200, net 800 (the 50% cache would give 500).
  select net_mdl into v_net_rest from public.payout_orders where order_id = v_a and recipient_type = 'restaurant';
  if v_net_rest is distinct from 800.00 then
    raise exception 'FAIL restaurant: net=% (expected 800 from the 20%% in effect at delivery, not the 50%% cache)', v_net_rest;
  end if;

  -- Courier: 15% of fee 50 => commission 7.50, net (50 fee + 0 tip) - 7.50 = 42.50
  -- (the 40% cache would give net 30.00).
  select net_mdl into v_net_courier from public.payout_orders where order_id = v_b and recipient_type = 'courier';
  if v_net_courier is distinct from 42.50 then
    raise exception 'FAIL courier: net=% (expected 42.50 from the 15%% in effect at delivery, not the 40%% cache)', v_net_courier;
  end if;

  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS: payouts use the pricing_config version in effect at delivery (restaurant net 800, courier net 42.50), not the current cache';
end $$;
