-- 105 — SYSTEM SCENARIO 4 (interconnection gate I3, owned by CLIENT): the customer cancels in every
-- state where it is allowed and is refused in every other. Allowed: pending_restaurant (and a repeat
-- on an already cancelled order is a no-op). Refused ("too late to cancel"): accepted,
-- ready_for_pickup, courier_assigned, picked_up, en_route, delivered, rejected. After an allowed
-- cancel: the status, the timeline event (actor customer), no live dispatch offer, the customer push.
-- After a refusal: nothing changed.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_courier uuid;
  v_item uuid; v_qty int; v_addr uuid; v_items jsonb; v_o uuid; v_status text;
  s text;
  n int := 0;
begin
  select id into v_courier from public.couriers order by created_at limit 1;
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
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng)
  values (v_cust, 'sim105', '+37360000000', 47.0250, 28.8330) returning id into v_addr;
  v_items := jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty));

  foreach s in array array['pending_restaurant', 'accepted', 'ready_for_pickup', 'courier_assigned',
                           'picked_up', 'en_route', 'delivered', 'rejected'] loop
    n := n + 1;
    perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
    v_o := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
             p_items => v_items, p_delivery_address_id => v_addr, p_idempotency_key => 'sim105-' || s);
    perform set_config('request.jwt.claims', null, true);
    if s <> 'pending_restaurant' then
      update public.orders set status = s,
             courier_id = case when s in ('courier_assigned', 'picked_up', 'en_route', 'delivered') then v_courier end
       where id = v_o;
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
    begin
      perform public.cancel_order(v_o, 'm-am răzgândit');
      if s <> 'pending_restaurant' then raise exception 'FAIL 105: customer cancelled in state %', s; end if;
    exception when raise_exception then
      if sqlerrm like 'FAIL%' then raise; end if;
      if s = 'pending_restaurant' then raise exception 'FAIL 105: customer refused in pending_restaurant: %', sqlerrm; end if;
      if sqlerrm not like 'too late to cancel%' then raise exception 'FAIL 105: % refused with %', s, sqlerrm; end if;
    end;
    perform set_config('request.jwt.claims', null, true);

    select status into v_status from public.orders where id = v_o;
    if s = 'pending_restaurant' then
      if v_status <> 'cancelled' then raise exception 'FAIL 105: allowed cancel left %', v_status; end if;
      if not exists (select 1 from public.delivery_status_events where order_id = v_o and status = 'cancelled' and actor_role = 'customer') then
        raise exception 'FAIL 105: no customer cancel event on the timeline';
      end if;
      if exists (select 1 from public.dispatch_offers where order_id = v_o and status = 'offered') then
        raise exception 'FAIL 105: a live dispatch offer survived the cancel';
      end if;
      if not exists (select 1 from public.notification_outbox where user_id = v_cust and tag = 'order-' || v_o::text and title like 'Comanda a fost anulată%') then
        raise exception 'FAIL 105: no cancellation push for the customer';
      end if;
      -- a repeated cancel (double tap / retry) is a no-op, not an error and not a second event
      perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
      perform public.cancel_order(v_o, 'din nou');
      perform set_config('request.jwt.claims', null, true);
      if (select count(*) from public.delivery_status_events where order_id = v_o and status = 'cancelled') <> 1 then
        raise exception 'FAIL 105: a repeated cancel wrote a second event';
      end if;
    elsif v_status <> s then
      raise exception 'FAIL 105: a refused cancel changed % to %', s, v_status;
    end if;
  end loop;
  raise notice 'PASS 105: customer cancel allowed only while pending_restaurant (+ idempotent), refused in % other states', n - 1;
end $$;
