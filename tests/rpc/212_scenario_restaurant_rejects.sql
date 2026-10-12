-- 212 — SYSTEM SCENARIO 2 (interconnection gate I3, owned by RESTAURANT): the restaurant rejects
-- the order. Real RPCs: place_order (customer) → reject_order (partner, preset reason), then a
-- second reject (a retried tap) and a late accept. State checked in all four apps + the ledger:
-- CLIENT sees `rejected` + the reason + a push; RESTAURANT: out of the queue, in the 30-day
-- history; CURIER: no offer, no courier; ADMIN: off the live board, rejected + reason on the order page; LEDGER: no cash
-- movement, no payout line, no courier fee; payment: a cash order stays unpaid.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_item uuid; v_qty int; v_addr uuid; v_items jsonb; v_o uuid; v_on uuid; v_on2 uuid; n int; v_status text; v_pay text;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  update public.restaurants set accepting_orders = true, is_active = true where id = v_rest;
  select mi.id, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int into v_item, v_qty
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and (mi.sold_out_until is null or mi.sold_out_until <= now())
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  v_items := jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty));
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng)
  values (v_cust, 'sim212', '+37360000000', 47.0300, 28.8400) returning id into v_addr;

  -- the customer orders (cash)
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_o := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
           p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim212-cash');

  -- the kitchen rejects, then the tap is retried, then someone presses Accept late
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  perform public.reject_order(v_o, 'Bucătăria e supraîncărcată');
  perform public.reject_order(v_o, 'Bucătăria e supraîncărcată'); -- idempotent retry
  begin
    perform public.accept_order(v_o);
    raise exception 'S2.R: a rejected order was accepted';
  exception when raise_exception then if sqlerrm like 'S2.R%' then raise; end if;
  end;

  -- RESTAURANT: out of the queue, in the history
  select count(*) into n from public.orders where id = v_o and status in ('pending_restaurant','accepted','ready_for_pickup');
  if n <> 0 then raise exception 'S2.restaurant: still in the queue'; end if;
  select count(*) into n from public.orders where id = v_o and status in ('delivered','cancelled','rejected') and created_at >= now() - interval '30 days';
  if n <> 1 then raise exception 'S2.restaurant: missing from the 30-day history'; end if;

  -- CLIENT: rejected + the exact reason, one timeline event (no double transition), one push
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  select status into v_status from public.orders where id = v_o and cancellation_reason = 'Bucătăria e supraîncărcată';
  if v_status is distinct from 'rejected' then raise exception 'S2.client: sees % / no reason', v_status; end if;
  reset role;
  select count(*) into n from public.delivery_status_events where order_id = v_o and status = 'rejected';
  if n <> 1 then raise exception 'S2.client: % rejected events (double transition?)', n; end if;
  select count(*) into n from public.notification_outbox where user_id = v_cust and tag = 'order-' || v_o::text;
  if n < 1 then raise exception 'S2.client: no status push to the customer'; end if;

  -- CURIER: nothing was ever offered or assigned
  select count(*) into n from public.dispatch_offers where order_id = v_o;
  if n <> 0 then raise exception 'S2.curier: % dispatch offers for a rejected order', n; end if;
  if (select courier_id from public.orders where id = v_o) is not null then raise exception 'S2.curier: a courier is attached'; end if;

  -- ADMIN: off the live board (it lists only open orders), visible as rejected with its reason
  -- on the order page (/platform/orders/[id] reads orders under orders_admin_all)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.admin_order_board where id = v_o;
  if n <> 0 then raise exception 'S2.admin: a rejected order is still on the live board'; end if;
  select count(*) into n from public.orders where id = v_o and status = 'rejected' and cancellation_reason is not null;
  reset role;
  if n <> 1 then raise exception 'S2.admin: the order page does not show it rejected with the reason'; end if;

  -- LEDGER: no money moved
  select count(*) into n from public.courier_cash_movements where order_id = v_o;
  if n <> 0 then raise exception 'S2.ledger: cash movement on a rejected order'; end if;
  select count(*) into n from public.payout_orders where order_id = v_o;
  if n <> 0 then raise exception 'S2.ledger: payout line on a rejected order'; end if;
  select courier_fee_mdl, payment_status into n, v_pay from public.orders where id = v_o;
  if n is not null then raise exception 'S2.ledger: courier fee % on a rejected order', n; end if;
  if v_pay <> 'unpaid' then raise exception 'S2.ledger: cash order payment_status=% after reject', v_pay; end if;

  -- R2/R3 (owner decision 2026-10-12): an online order that is already PAID and then rejected
  -- (R2) or cancelled by the restaurant after accepting (R3) goes to refund_pending — the admin
  -- refunds it. Before 000307 it stayed `paid`: the customer's money was kept with no refund path,
  -- while the cancel push promised "restituirea pornește automat".
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_cust, v_rest, v_addr, 'pending_restaurant', 'online_gateway', 'paid', 200, 30, 230)
  returning id into v_on;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_cust, v_rest, v_addr, 'accepted', 'online_gateway', 'paid', 200, 30, 230)
  returning id into v_on2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reject_order(v_on, 'Produs epuizat');
  perform public.restaurant_cancel_order(v_on2, 'Cuptorul s-a defectat');
  reset role;
  select payment_status into v_pay from public.orders where id = v_on;
  if v_pay <> 'refund_pending' then raise exception 'S2.R2: paid online order rejected → payment_status=% (want refund_pending)', v_pay; end if;
  select payment_status into v_pay from public.orders where id = v_on2;
  if v_pay <> 'refund_pending' then raise exception 'S2.R3: paid online order cancelled by the restaurant → payment_status=% (want refund_pending)', v_pay; end if;
  -- the cash order above did not become refund_pending (nothing was paid)
  if (select payment_status from public.orders where id = v_o) <> 'unpaid' then raise exception 'S2.R4: cash order touched'; end if;

  raise notice 'system scenario 2 (restaurant rejects) OK';
end $$;
