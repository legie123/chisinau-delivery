-- CROSS TEST (consumer = RESTAURANT, provider = CLIENT `place_order`). Written by RESTAURANT per
-- the interconnect rule: the kitchen depends on these CLIENT behaviours, so it pins them.
-- X1 a dish the partner marks sold out with set_menu_item_sold_out is refused by place_order,
--    and orderable again after 'off';  X2 a paused restaurant (accepting_orders=false, the
--    partner's toggle) gets no order;  X3 a placed order reaches the kitchen: visible to the
--    restaurant's staff under RLS, pending_restaurant, with a "Comandă nouă" push queued for
--    every staff member;  X4 a rejection reason reaches the customer. Do not weaken: change only by RESTAURANT, reason in CROSS-REQUESTS.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_item uuid; v_qty int; v_addr uuid; v_oid uuid; v_items jsonb; v_n int; v_staff int;
begin
  -- arrange as CLIENT's own sims do: open all day, accepting, pinned address inside the radius
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
  values (v_cust, 'sim210', '+37360000000', 47.0300, 28.8400) returning id into v_addr;
  select count(*) into v_staff from public.restaurant_staff where restaurant_id = v_rest;

  -- X1: the partner marks it sold out → the customer cannot order it
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_menu_item_sold_out(v_item, 'today');
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim210-soldout');
    raise exception 'X1: a sold-out dish was ordered';
  exception when raise_exception then
    if sqlerrm like 'X1%' then raise; end if;
    if sqlerrm not like '%epuizat%' then raise exception 'X1: wrong refusal: %', sqlerrm; end if;
  end;
  -- … and orderable again once the partner switches it back
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  perform public.set_menu_item_sold_out(v_item, 'off');

  -- X2: the partner pauses orders → refused
  reset role;
  update public.restaurants set accepting_orders = false where id = v_rest; -- what AcceptingOrdersToggle writes
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim210-paused');
    raise exception 'X2: a paused restaurant received an order';
  exception when raise_exception then
    if sqlerrm like 'X2%' then raise; end if;
  end;
  reset role;
  update public.restaurants set accepting_orders = true where id = v_rest;
  set local role authenticated;

  -- X3: placed → in the kitchen's queue, with a push for every staff member
  v_oid := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
            p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim210-ok');
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.orders where id = v_oid and status = 'pending_restaurant';
  if v_n <> 1 then raise exception 'X3: the kitchen does not see the new order as pending (% rows)', v_n; end if;
  reset role;
  select count(*) into v_n from public.notification_outbox where tag = 'neworder:' || v_oid and url = '/restaurant/orders';
  if v_n <> v_staff then raise exception 'X3: % new-order pushes for % staff', v_n, v_staff; end if;

  -- X4: the kitchen rejects with a preset reason → the customer reads exactly that reason
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reject_order(v_oid, 'Produs epuizat');
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.orders where id = v_oid and status = 'rejected' and cancellation_reason = 'Produs epuizat';
  reset role;
  if v_n <> 1 then raise exception 'X4: the customer does not see the rejection reason'; end if;

  raise notice 'cross client→kitchen X1-X4 OK';
end $$;
