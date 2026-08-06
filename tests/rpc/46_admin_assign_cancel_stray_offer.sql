-- MARELE AUDIT 2026-08-03 — DispatchCourierAudit #1 (P1).
-- Proves admin_assign_courier cancels the target courier's OTHER live offer so
-- it can't expire and ghost-auto-offline an active courier. Scenario: courier X
-- has a live 'offered' offer for order A; admin manually assigns X to order B;
-- X's offer for A must become 'cancelled'. Runner wraps in BEGIN/ROLLBACK as
-- postgres; admin auth via jwt claims (RPC is SECURITY DEFINER + has_role gate).

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_cust  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_courier uuid;
  v_a uuid; v_b uuid; v_offer_status text;
begin
  select id into v_rest from public.restaurants where is_active limit 1;
  -- a courier with no active delivery, so admin_assign's capacity check passes.
  select c.id into v_courier
  from public.couriers c
  where not exists (
    select 1 from public.orders o
    where o.courier_id = c.id and o.status in ('courier_assigned','picked_up','en_route'))
  limit 1;
  update public.couriers set status = 'online' where id = v_courier;

  -- order A: ready, no courier, with a LIVE offer to the courier.
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_cust, v_rest, 'ready_for_pickup', 'cash', 'unpaid', 200, 20, 220)
  returning id into v_a;
  insert into public.dispatch_offers (order_id, courier_id, wave, score, distance_km, status, offered_at, expires_at)
  values (v_a, v_courier, 1, 1.0, 2.0, 'offered', now(), now() + interval '30 seconds');

  -- order B: ready, no courier — the one admin assigns the courier to.
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_cust, v_rest, 'ready_for_pickup', 'cash', 'unpaid', 300, 20, 320)
  returning id into v_b;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_assign_courier(v_b, v_courier);

  select status into v_offer_status from public.dispatch_offers where order_id = v_a and courier_id = v_courier;
  if v_offer_status is distinct from 'cancelled' then
    raise exception 'FAIL: stray offer for order A is still "%" after the courier was assigned to B (it would expire and ghost-auto-offline an active courier)', v_offer_status;
  end if;

  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS: manual assign cancels the target courier stray live offer (A -> cancelled), no false ghost';
end $$;
