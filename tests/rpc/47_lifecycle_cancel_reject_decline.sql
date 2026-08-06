-- MARELE AUDIT 2026-08-03 — FoundationSectorAudit (HIGH): 3 core lifecycle
-- transitions shipped with ZERO test coverage. This file is the safety net for
-- cancel_order / reject_order / decline_catering_quote — authorization, valid/
-- invalid transitions, idempotency, and side effects (courier release, offer
-- cancel, catering quote_status). Runner wraps in BEGIN/ROLLBACK as postgres;
-- auth simulated via request.jwt.claims (these RPCs are SECURITY DEFINER and
-- gate on auth.uid()/has_role/has_restaurant_access, no table RLS involved).

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111'; -- Sakura
  v_owner uuid := 'a0000000-0000-0000-0000-000000000001'; -- customer (order owner)
  v_other uuid := 'a0000000-0000-0000-0000-000000000002'; -- a different customer
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003'; -- staff of v_rest
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier uuid;
  v_o uuid; v_status text; v_cstatus text; v_qstatus text; v_ev int; v_ok boolean;
begin
  select id into v_courier from public.couriers limit 1;

  -- ===================== cancel_order =====================

  -- (1) owner cancels own pending_restaurant order -> cancelled + event logged.
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_owner, v_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 20, 220) returning id into v_o;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.cancel_order(v_o, 'm-am razgandit');
  select status into v_status from public.orders where id = v_o;
  if v_status <> 'cancelled' then raise exception 'FAIL cancel(1): owner pending -> % (expected cancelled)', v_status; end if;
  select count(*) into v_ev from public.delivery_status_events where order_id = v_o and status = 'cancelled';
  if v_ev < 1 then raise exception 'FAIL cancel(1): no cancelled event logged'; end if;

  -- (2) owner CANNOT cancel after pending_restaurant (accepted) -> "too late".
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_owner, v_rest, 'accepted', 'cash', 'unpaid', 200, 20, 220) returning id into v_o;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_ok := false;
  begin perform public.cancel_order(v_o, 'x'); exception when others then v_ok := (sqlerrm like '%too late%'); end;
  if not v_ok then raise exception 'FAIL cancel(2): owner cancel after accepted should be rejected (too late)'; end if;

  -- (3) a different customer cannot cancel someone else's order -> not authorized.
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_owner, v_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 20, 220) returning id into v_o;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  v_ok := false;
  begin perform public.cancel_order(v_o, 'x'); exception when others then v_ok := (sqlerrm like '%not authorized%'); end;
  if not v_ok then raise exception 'FAIL cancel(3): non-owner non-admin should be not authorized'; end if;

  -- (4) admin cancels an in-flight order -> cancelled + courier released to online + offer cancelled.
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_owner, v_rest, v_courier, 'courier_assigned', 'cash', 'unpaid', 200, 20, 220) returning id into v_o;
  update public.couriers set status = 'on_delivery' where id = v_courier;
  insert into public.dispatch_offers (order_id, courier_id, wave, score, distance_km, status, offered_at, expires_at)
  values (v_o, v_courier, 1, 1.0, 2.0, 'offered', now(), now() + interval '30 seconds');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.cancel_order(v_o, 'client necontactabil');
  select status into v_status from public.orders where id = v_o;
  if v_status <> 'cancelled' then raise exception 'FAIL cancel(4): admin in-flight cancel -> %', v_status; end if;
  select status into v_cstatus from public.couriers where id = v_courier;
  if v_cstatus <> 'online' then raise exception 'FAIL cancel(4): courier not released (status %)', v_cstatus; end if;
  select status into v_status from public.dispatch_offers where order_id = v_o;
  if v_status <> 'cancelled' then raise exception 'FAIL cancel(4): dispatch offer not cancelled (%)', v_status; end if;

  -- (5) idempotent: cancelling an already-cancelled order is a no-op, no error.
  perform public.cancel_order(v_o, 'again');
  select status into v_status from public.orders where id = v_o;
  if v_status <> 'cancelled' then raise exception 'FAIL cancel(5): idempotent cancel changed status to %', v_status; end if;

  -- ===================== reject_order =====================

  -- (6) partner rejects a pending order -> rejected + event.
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_owner, v_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 20, 220) returning id into v_o;
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  perform public.reject_order(v_o, 'nu avem ingrediente');
  select status into v_status from public.orders where id = v_o;
  if v_status <> 'rejected' then raise exception 'FAIL reject(6): partner reject -> %', v_status; end if;

  -- (7) a customer cannot reject (no restaurant access) -> not authorized.
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_owner, v_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 20, 220) returning id into v_o;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_ok := false;
  begin perform public.reject_order(v_o, 'x'); exception when others then v_ok := (sqlerrm like '%not authorized%'); end;
  if not v_ok then raise exception 'FAIL reject(7): customer should not be able to reject'; end if;

  -- (8) partner cannot reject an already-accepted order -> invalid transition.
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_owner, v_rest, 'accepted', 'cash', 'unpaid', 200, 20, 220) returning id into v_o;
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  v_ok := false;
  begin perform public.reject_order(v_o, 'x'); exception when others then v_ok := (sqlerrm like '%invalid transition%'); end;
  if not v_ok then raise exception 'FAIL reject(8): reject after accepted should be an invalid transition'; end if;

  -- ===================== decline_catering_quote =====================

  -- (10) partner declines a catering order in pending -> quote declined + order rejected.
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('catering', v_owner, v_rest, 'pending_restaurant', 'cash', 'unpaid', 5000, 0, 5000) returning id into v_o;
  insert into public.catering_details (order_id, event_date, guest_count, event_address_text, contact_person, contact_phone)
  values (v_o, current_date + 10, 40, 'Sala X', 'Ion', '+37360000000');
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  perform public.decline_catering_quote(v_o, 'nu putem la acea data');
  select status into v_status from public.orders where id = v_o;
  select quote_status into v_qstatus from public.catering_details where order_id = v_o;
  if v_status <> 'rejected' then raise exception 'FAIL decline(10): order status -> % (expected rejected)', v_status; end if;
  if v_qstatus <> 'declined' then raise exception 'FAIL decline(10): quote_status -> % (expected declined)', v_qstatus; end if;

  -- (11) decline on a NON-catering order -> "not a catering order".
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_owner, v_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 20, 220) returning id into v_o;
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  v_ok := false;
  begin perform public.decline_catering_quote(v_o, 'x'); exception when others then v_ok := (sqlerrm like '%not a catering order%'); end;
  if not v_ok then raise exception 'FAIL decline(11): non-catering order should be rejected by decline_catering_quote'; end if;

  -- (12) a customer cannot decline a catering quote (no restaurant access).
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('catering', v_owner, v_rest, 'pending_restaurant', 'cash', 'unpaid', 5000, 0, 5000) returning id into v_o;
  insert into public.catering_details (order_id, event_date, guest_count, event_address_text, contact_person, contact_phone)
  values (v_o, current_date + 10, 40, 'Sala Y', 'Ana', '+37360000001');
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_ok := false;
  begin perform public.decline_catering_quote(v_o, 'x'); exception when others then v_ok := (sqlerrm like '%not authorized%'); end;
  if not v_ok then raise exception 'FAIL decline(12): customer should not be able to decline a catering quote'; end if;

  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS: cancel_order + reject_order + decline_catering_quote — 12 assertions (authz, transitions, idempotency, side effects)';
end $$;
