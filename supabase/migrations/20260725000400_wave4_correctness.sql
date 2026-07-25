-- ============================================================================
-- WAVE 4 — CORRECTNESS (audit wf_00722b5f-708 backend cluster)
--  #18 [HIGH] place_order never checked restaurant_hours — orders landed in closed
--       kitchens at 3 AM. New restaurant_open_at() helper + gate (standard only;
--       catering is quote-first with its own event date).
--  #29 [MED] place_order accepted a standard delivery with NO address (and never
--       verified address ownership). Now required + must belong to the caller.
--  #16 [HIGH] assign_courier (pull path) could snipe an order that is under an
--       exclusive live push offer to a DIFFERENT courier, wasting the scored
--       dispatch. Now blocked while a foreign live offer exists.
--  #30 [MED] set_courier_online_status could overwrite 'on_delivery' mid-delivery.
--  #52 [LOW] going offline now declines the courier's live offers (the 15s expire
--       sweeper re-dispatches the order; before, the offer just sat until expiry).
--  #44 [MED] review_onboarding_application inserted applicant-controlled economics
--       verbatim. Now clamped to platform bounds + slug sanitized/uniquified.
--  #45 [MED] notification_outbox drain had no atomic claim — overlapping cron ticks
--       could double-send. New claim RPC (FOR UPDATE SKIP LOCKED + reclaim window).
-- ============================================================================

-- ---- #18 helper: is the restaurant open at a given moment (service timezone)? ----
create or replace function public.restaurant_open_at(p_restaurant_id uuid, p_at timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurant_hours h
    where h.restaurant_id = p_restaurant_id
      and h.day_of_week = extract(dow from (p_at at time zone 'Europe/Chisinau'))::int
      and not h.is_closed
      and case
            when h.closes_at > h.opens_at
              then (p_at at time zone 'Europe/Chisinau')::time between h.opens_at and h.closes_at
            -- overnight span (closes past midnight)
            else (p_at at time zone 'Europe/Chisinau')::time >= h.opens_at
              or (p_at at time zone 'Europe/Chisinau')::time <= h.closes_at
          end
  );
$$;

-- ---- place_order: body preserved from 20260717002400 + #29 address gate + #18 hours gate ----
create or replace function public.place_order(
  p_restaurant_id uuid, p_order_type text, p_payment_method text, p_items jsonb,
  p_delivery_address_id uuid default null, p_requested_for timestamptz default null,
  p_notes text default null, p_catering jsonb default null
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
    -- #29: a delivery order needs a real dropoff that belongs to the caller.
    if p_delivery_address_id is null then
      raise exception 'adresa de livrare este obligatorie';
    end if;
    if not exists (select 1 from public.addresses a where a.id = p_delivery_address_id and a.customer_id = auth.uid()) then
      raise exception 'adresa de livrare nu îți aparține';
    end if;
    -- #18: the kitchen must be open at the moment the order is meant to hit it.
    if not public.restaurant_open_at(p_restaurant_id, coalesce(p_requested_for, now())) then
      raise exception 'restaurantul este închis la ora selectată';
    end if;
  end if;

  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, payment_method, delivery_fee_mdl, requested_for, notes)
  values (p_order_type, auth.uid(), p_restaurant_id, p_delivery_address_id, p_payment_method, v_restaurant.delivery_fee_mdl, p_requested_for, p_notes)
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

-- ---- #16: pull-claim must respect a live push offer held by ANOTHER courier ----
create or replace function public.assign_courier(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_courier_id uuid;
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;
  perform 1 from public.couriers where id = v_courier_id for update;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.courier_id = v_courier_id and v_order.status = 'courier_assigned' then return; end if;

  if not public.courier_has_capacity(v_courier_id) then
    raise exception 'you already have an active delivery';
  end if;
  if public.courier_dispatch_distance_m(v_courier_id, v_order.restaurant_id) > 15000 then
    raise exception 'too far from restaurant to claim this order';
  end if;
  if v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    raise exception 'order not available for assignment';
  end if;
  -- #16: while the scored dispatch has a LIVE offer out to someone else, the pull
  -- path may not snipe the order (own offer is fine — same claim, different door).
  if exists (
    select 1 from public.dispatch_offers
    where order_id = p_order_id and status = 'offered'
      and expires_at > now() and courier_id <> v_courier_id
  ) then
    raise exception 'comanda este oferită altui curier în acest moment';
  end if;

  update public.orders set status = 'courier_assigned', courier_id = v_courier_id where id = p_order_id;
  update public.couriers set status = 'on_delivery' where id = v_courier_id;
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where (order_id = p_order_id or courier_id = v_courier_id) and status = 'offered';

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'courier_assigned', 'courier', auth.uid());
end;
$$;

-- ---- #30 + #52: online-status toggle can't stomp an active delivery; offline drops offers ----
create or replace function public.set_courier_online_status(p_status text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_courier public.couriers%rowtype;
begin
  if p_status not in ('offline', 'online') then raise exception 'invalid status'; end if;
  select * into v_courier from public.couriers where user_id = auth.uid() and is_active for update;
  if not found then raise exception 'not an active courier'; end if;
  -- #30: mid-delivery state is owned by the order lifecycle, not the toggle.
  if v_courier.status = 'on_delivery' then
    raise exception 'ai o livrare activă — finalizeaz-o înainte să schimbi statusul';
  end if;
  update public.couriers set status = p_status where id = v_courier.id;
  -- #52: going dark declines any live offer; the expire sweeper re-dispatches.
  if p_status = 'offline' then
    update public.dispatch_offers set status = 'declined', responded_at = now()
    where courier_id = v_courier.id and status = 'offered';
  end if;
end;
$$;

-- ---- #44: clamp applicant-controlled economics + sanitize/uniquify the slug ----
create or replace function public.review_onboarding_application(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare v_app public.onboarding_applications%rowtype; v_rid uuid; v_slug text; v_base text; v_n int := 0;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select * into v_app from public.onboarding_applications where id = p_id for update;
  if not found then raise exception 'application not found'; end if;
  if v_app.status <> 'pending' then raise exception 'already reviewed'; end if;

  if not p_approve then
    update public.onboarding_applications set status = 'rejected', review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
    return;
  end if;

  if v_app.user_id is null then raise exception 'applicant user missing'; end if;

  if v_app.applicant_type = 'courier' then
    update public.profiles set role = 'courier' where id = v_app.user_id;
    insert into public.couriers (user_id, full_name, phone, vehicle_type, status, is_active)
    values (v_app.user_id, v_app.full_name, v_app.phone, coalesce(v_app.details ->> 'vehicle_type', 'car'), 'offline', true)
    on conflict (user_id) do nothing;
  else
    update public.profiles set role = 'restaurant_partner' where id = v_app.user_id;
    -- slug: sanitized to [a-z0-9-]; collisions get a numeric suffix instead of erroring.
    v_base := nullif(regexp_replace(lower(coalesce(v_app.details ->> 'slug', v_app.details ->> 'name', v_app.full_name)), '[^a-z0-9]+', '-', 'g'), '');
    v_base := coalesce(trim(both '-' from v_base), 'rest-' || left(v_app.id::text, 8));
    v_slug := v_base;
    while exists (select 1 from public.restaurants where slug = v_slug) loop
      v_n := v_n + 1; v_slug := v_base || '-' || v_n;
    end loop;
    insert into public.restaurants (slug, name, cuisine_type, address, sector, phone, is_active, accepting_orders, delivery_fee_mdl, min_order_amount_mdl, avg_prep_minutes)
    values (
      v_slug,
      coalesce(v_app.details ->> 'name', v_app.full_name),
      case when v_app.details ->> 'cuisine_type' in ('sushi','fine_dining','other') then v_app.details ->> 'cuisine_type' else 'other' end,
      coalesce(v_app.details ->> 'address', ''),
      v_app.details ->> 'sector',
      v_app.phone, false, false,
      -- platform bounds, not applicant wishes: fee 0..200, minimum 0..1000, prep 5..180
      least(greatest(coalesce((v_app.details ->> 'delivery_fee_mdl')::numeric, 40), 0), 200),
      least(greatest(coalesce((v_app.details ->> 'min_order_amount_mdl')::numeric, 150), 0), 1000),
      least(greatest(coalesce((v_app.details ->> 'avg_prep_minutes')::int, 30), 5), 180)
    ) returning id into v_rid;
    insert into public.restaurant_staff (user_id, restaurant_id) values (v_app.user_id, v_rid) on conflict do nothing;
  end if;

  update public.onboarding_applications set status = 'approved', review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
end; $$;

-- ---- #45: atomic outbox claim (safe under overlapping cron ticks) ----
alter table public.notification_outbox add column if not exists claimed_at timestamptz;

create or replace function public.claim_notification_outbox(p_batch int default 50)
returns setof public.notification_outbox
language sql
security definer
set search_path = public
as $$
  update public.notification_outbox o
  set claimed_at = now()
  where o.id in (
    select id from public.notification_outbox
    where sent_at is null
      and attempts < 5
      -- unclaimed, or a claim older than the reclaim window (a crashed drain run)
      and (claimed_at is null or claimed_at < now() - interval '60 seconds')
    order by created_at
    limit p_batch
    for update skip locked
  )
  returning o.*;
$$;
revoke execute on function public.claim_notification_outbox(int) from public, anon, authenticated;
grant execute on function public.claim_notification_outbox(int) to service_role;
