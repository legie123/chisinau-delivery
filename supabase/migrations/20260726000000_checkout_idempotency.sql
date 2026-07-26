-- ============================================================================
-- WAVE 10 — CHECKOUT ATOMICITY / IDEMPOTENCY  (judgment panel BLOCKER #1)
-- place_order had no dedup: a refresh / browser-Back / any post-creation error
-- dropped the customer onto a still-populated checkout whose CTA fired place_order
-- again → a second real order + an orphaned unpaid order the kitchen could still
-- cook. Add a client-supplied idempotency key: a retry with the same key returns
-- the SAME order instead of inserting a new one.
--
-- Also #13: bound the payout selection by delivered_at >= p_start (a run could
-- otherwise sweep in and mislabel older delivered orders).
-- ============================================================================

alter table public.orders add column if not exists idempotency_key text;
-- One order per (customer, key). Partial: legacy/keyless orders are unaffected.
create unique index if not exists orders_idempotency_key_uidx
  on public.orders (customer_id, idempotency_key)
  where idempotency_key is not null;

-- Recreate place_order with a trailing optional idempotency key. Body preserved
-- from 20260725000400 (hours gate + address ownership) + the dedup short-circuit.
drop function if exists public.place_order(uuid, text, text, jsonb, uuid, timestamptz, text, jsonb);
create or replace function public.place_order(
  p_restaurant_id uuid, p_order_type text, p_payment_method text, p_items jsonb,
  p_delivery_address_id uuid default null, p_requested_for timestamptz default null,
  p_notes text default null, p_catering jsonb default null, p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_order_id uuid;
  v_subtotal numeric(10, 2) := 0;
  v_item jsonb;
  v_menu_item public.menu_items%rowtype;
  v_qty int;
  v_line_total numeric(10, 2);
  v_min numeric(10, 2);
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  -- Idempotency short-circuit: a retry with the same key returns the first order.
  if p_idempotency_key is not null then
    select id into v_order_id from public.orders
    where customer_id = auth.uid() and idempotency_key = p_idempotency_key;
    if v_order_id is not null then return v_order_id; end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'cart is empty'; end if;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id;
  if not found then raise exception 'restaurant not found'; end if;
  if not v_restaurant.is_active or not v_restaurant.accepting_orders then
    raise exception 'restaurant is not currently accepting orders';
  end if;
  if p_order_type = 'catering' and (not v_restaurant.accepts_catering or p_catering is null) then
    raise exception 'invalid catering request';
  end if;

  if p_order_type = 'standard' then
    if p_delivery_address_id is null then
      raise exception 'adresa de livrare este obligatorie';
    end if;
    if not exists (select 1 from public.addresses a where a.id = p_delivery_address_id and a.customer_id = auth.uid()) then
      raise exception 'adresa de livrare nu îți aparține';
    end if;
    if not public.restaurant_open_at(p_restaurant_id, coalesce(p_requested_for, now())) then
      raise exception 'restaurantul este închis la ora selectată';
    end if;
  end if;

  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, payment_method, delivery_fee_mdl, requested_for, notes, idempotency_key)
  values (p_order_type, auth.uid(), p_restaurant_id, p_delivery_address_id, p_payment_method, v_restaurant.delivery_fee_mdl, p_requested_for, p_notes, p_idempotency_key)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_menu_item
    from public.menu_items
    where id = (v_item ->> 'menu_item_id')::uuid
      and restaurant_id = p_restaurant_id
      and is_available = true;
    if not found then raise exception 'menu item unavailable'; end if;

    if v_menu_item.is_catering_only and p_order_type <> 'catering' then
      raise exception 'produsul % este disponibil doar pentru catering', v_menu_item.name;
    end if;

    v_qty := (v_item ->> 'quantity')::int;
    if v_qty <= 0 or (v_menu_item.catering_min_qty is not null and v_qty < v_menu_item.catering_min_qty) then
      raise exception 'invalid quantity for %', v_menu_item.name;
    end if;

    v_line_total := v_menu_item.price_mdl * v_qty;
    insert into public.order_items (order_id, menu_item_id, item_name_snapshot, unit_price_mdl, quantity, line_total_mdl)
    values (v_order_id, v_menu_item.id, v_menu_item.name, v_menu_item.price_mdl, v_qty, v_line_total);
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_min := case when p_order_type = 'catering' then v_restaurant.catering_min_amount_mdl else v_restaurant.min_order_amount_mdl end;
  if v_min is not null and v_subtotal < v_min then
    raise exception 'subtotal % MDL below minimum % MDL', v_subtotal, v_min;
  end if;

  update public.orders set subtotal_mdl = v_subtotal, total_mdl = v_subtotal + delivery_fee_mdl where id = v_order_id;

  if p_order_type = 'catering' then
    insert into public.catering_details (order_id, event_date, event_time, guest_count, event_address_text, contact_person, contact_phone)
    values (v_order_id, (p_catering ->> 'event_date')::date, nullif(p_catering ->> 'event_time', '')::time,
            (p_catering ->> 'guest_count')::int, p_catering ->> 'event_address_text',
            p_catering ->> 'contact_person', p_catering ->> 'contact_phone');
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (v_order_id, 'pending_restaurant', 'customer', auth.uid());
  return v_order_id;
end;
$$;
revoke execute on function public.place_order(uuid, text, text, jsonb, uuid, timestamptz, text, jsonb, text) from public, anon;
grant execute on function public.place_order(uuid, text, text, jsonb, uuid, timestamptz, text, jsonb, text) to authenticated;

-- #13: bound the payout selection start so a wide run can't mislabel older orders.
create or replace function public.admin_generate_payouts(p_start date, p_end date)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_c record; v_settings public.platform_settings%rowtype; v_n int := 0;
        v_payout_id uuid; v_commission numeric(10,2);
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  perform pg_advisory_xact_lock(hashtext('admin_generate_payouts'));
  select * into v_settings from public.platform_settings where id;

  for v_c in
    select o.restaurant_id as rid, count(*) as cnt,
           sum(case when o.order_type = 'standard' then o.subtotal_mdl
                    else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end) as gross
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant')
    group by o.restaurant_id
  loop
    v_commission := round(v_c.gross * v_settings.restaurant_commission_pct / 100, 2);
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('restaurant', v_c.rid, p_start, p_end, v_c.cnt, v_c.gross, v_commission, v_c.gross - v_commission)
    returning id into v_payout_id;
    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
    select v_payout_id, o.id, 'restaurant', g.gross, g.gross - round(g.gross * v_settings.restaurant_commission_pct / 100, 2)
    from public.orders o
    cross join lateral (select (case when o.order_type = 'standard' then o.subtotal_mdl
                          else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end) as gross) g
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
      and o.restaurant_id = v_c.rid
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant');
    v_n := v_n + 1;
  end loop;

  for v_c in
    select o.courier_id as cid, count(*) as cnt,
           sum(o.delivery_fee_mdl + coalesce(o.tip_mdl, 0)) as gross,
           sum(o.delivery_fee_mdl) as fees
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id is not null
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier')
    group by o.courier_id
  loop
    v_commission := round(v_c.fees * v_settings.courier_commission_pct / 100, 2);
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('courier', v_c.cid, p_start, p_end, v_c.cnt, v_c.gross, v_commission, v_c.gross - v_commission)
    returning id into v_payout_id;
    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
    select v_payout_id, o.id, 'courier', o.delivery_fee_mdl + coalesce(o.tip_mdl, 0),
           (o.delivery_fee_mdl + coalesce(o.tip_mdl, 0)) - round(o.delivery_fee_mdl * v_settings.courier_commission_pct / 100, 2)
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id = v_c.cid
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier');
    v_n := v_n + 1;
  end loop;

  return v_n;
end; $$;
revoke execute on function public.admin_generate_payouts(date, date) from public, anon, authenticated;
grant execute on function public.admin_generate_payouts(date, date) to authenticated;
