-- Second hardening pass — backend defects confirmed by the 4-lens adversarial
-- backtest (BUCLA Agenți). Concurrency + data-integrity agents converged on the
-- catering flow, a lock-order inversion, and courier lifecycle gaps.

-- ============================================================================
-- #1 (HIGH, ×2 agents) expire_stale_orders auto-cancels CATERING orders.
-- Catering legitimately sits in pending_restaurant through its whole quote
-- lifecycle; the SLA sweeper (every minute) killed them after accept_sla_minutes.
-- The earlier pass fixed only the admin_stuck_orders VIEW, not the sweeper.
-- ============================================================================
create or replace function public.expire_stale_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired record;
  v_count int := 0;
begin
  for v_expired in
    select o.id
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where o.status = 'pending_restaurant'
      and o.order_type = 'standard'   -- #1: never auto-cancel catering (quote flow)
      and o.created_at < now() - make_interval(mins => r.accept_sla_minutes)
  loop
    update public.orders
    set status = 'cancelled',
        cancellation_reason = 'Restaurantul nu a confirmat comanda la timp — anulare automată.'
    where id = v_expired.id and status = 'pending_restaurant';
    if found then
      insert into public.delivery_status_events (order_id, status, actor_role, note)
      values (v_expired.id, 'cancelled', 'system', 'accept SLA timeout');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ============================================================================
-- #2 (HIGH) decline_catering_quote had no status guard / no row lock: a partner
-- could force 'rejected' from ANY state (en_route, delivered, cancelled). Mirror
-- the confirm_catering_quote fix.
-- ============================================================================
create or replace function public.decline_catering_quote(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.order_type <> 'catering' then raise exception 'not a catering order'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status <> 'pending_restaurant' then
    raise exception 'invalid transition from % — comanda nu mai poate fi refuzată', v_order.status;
  end if;

  update public.catering_details set quote_status = 'declined', restaurant_notes = p_reason where order_id = p_order_id;
  update public.orders set status = 'rejected', cancellation_reason = p_reason where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'rejected', (select role from public.profiles where id = auth.uid()), auth.uid(), p_reason);
end;
$$;

-- ============================================================================
-- #6-data (MED) submit_catering_quote ignored orders.status → quotes landed on
-- cancelled/rejected terminal orders. Add FOR UPDATE + pending_restaurant guard.
-- ============================================================================
create or replace function public.submit_catering_quote(p_order_id uuid, p_quoted_total_mdl numeric)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_details public.catering_details%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.order_type <> 'catering' then raise exception 'not a catering order'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status <> 'pending_restaurant' then raise exception 'comanda nu mai este activă'; end if;

  select * into v_details from public.catering_details where order_id = p_order_id;
  if not found or v_details.quote_status <> 'requested' then raise exception 'quote already submitted'; end if;
  if p_quoted_total_mdl <= 0 then raise exception 'invalid quote amount'; end if;

  update public.catering_details set quote_status = 'quoted', quoted_total_mdl = p_quoted_total_mdl where order_id = p_order_id;
end;
$$;

-- ============================================================================
-- #2-data (MED) place_order did NOT enforce is_catering_only, so a catering-only
-- item could be bought as a standard order (skipping the quote flow + catering
-- minimum). Body preserved verbatim + one guard in the item loop.
-- ============================================================================
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

    -- #2-data: a catering-only item can only be ordered through the catering flow.
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

-- ============================================================================
-- #3 (MED) lock-order inversion → deadlocks. Canonical order EVERYWHERE:
-- courier → order → offer. accept/decline previously locked offer→order.
-- Also removes the dead `update ... set cancelled; raise` in accept (rolled back
-- by the raise anyway; the winning assign_courier already cancels the live offer).
-- ============================================================================
create or replace function public.accept_dispatch_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_offer public.dispatch_offers%rowtype;
  v_courier_id uuid;
  v_order_id uuid;
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;
  perform 1 from public.couriers where id = v_courier_id for update;                 -- (1) courier

  select order_id into v_order_id from public.dispatch_offers where id = p_offer_id;
  if v_order_id is null then raise exception 'offer not found'; end if;
  perform 1 from public.orders where id = v_order_id for update;                     -- (2) order

  select * into v_offer from public.dispatch_offers where id = p_offer_id for update; -- (3) offer
  if not found or v_offer.courier_id <> v_courier_id then raise exception 'offer not found'; end if;
  if v_offer.status = 'accepted' then return; end if;
  if v_offer.status <> 'offered' or v_offer.expires_at <= now() then raise exception 'oferta a expirat'; end if;
  if not public.courier_has_capacity(v_courier_id) then raise exception 'you already have an active delivery'; end if;

  update public.orders
  set status = 'courier_assigned', courier_id = v_courier_id
  where id = v_offer.order_id and status = 'ready_for_pickup' and courier_id is null;
  if not found then raise exception 'comanda nu mai este disponibila'; end if;

  update public.dispatch_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update public.couriers set status = 'on_delivery' where id = v_courier_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (v_offer.order_id, 'courier_assigned', 'courier', auth.uid());
end;
$$;

create or replace function public.decline_dispatch_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_offer public.dispatch_offers%rowtype;
  v_courier_id uuid;
  v_order_id uuid;
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;

  select order_id into v_order_id from public.dispatch_offers where id = p_offer_id;
  if v_order_id is null then raise exception 'offer not found'; end if;
  perform 1 from public.orders where id = v_order_id for update;                     -- order first
  select * into v_offer from public.dispatch_offers where id = p_offer_id for update; -- then offer
  if not found or v_offer.courier_id <> v_courier_id then raise exception 'offer not found'; end if;
  if v_offer.status = 'declined' then return; end if;
  if v_offer.status <> 'offered' then raise exception 'oferta nu mai este activa'; end if;

  update public.dispatch_offers set status = 'declined', responded_at = now() where id = p_offer_id;
  begin
    perform public.dispatch_order(v_offer.order_id);
  exception when unique_violation then null;
  end;
end;
$$;

-- ============================================================================
-- #5 (LOW) pull-claim left the claimant's OWN live offer (on another order)
-- dangling → blocked that order's cascade + penalized the courier. Cancel it too.
-- (assign_courier body = live 002000 version + this WHERE change.)
-- ============================================================================
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

  update public.orders set status = 'courier_assigned', courier_id = v_courier_id where id = p_order_id;
  update public.couriers set status = 'on_delivery' where id = v_courier_id;
  -- #5: cancel this order's live offer AND any live offer this courier still holds elsewhere.
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where (order_id = p_order_id or courier_id = v_courier_id) and status = 'offered';

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'courier_assigned', 'courier', auth.uid());
end;
$$;

-- ============================================================================
-- #4 (MED) cancel_order never freed the courier: admin-cancelling an in-flight
-- order stranded them 'on_delivery' (no more push offers). Free them.
-- ============================================================================
create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if v_order.customer_id = auth.uid() then
    if v_order.status = 'cancelled' then return; end if;
    if v_order.status <> 'pending_restaurant' then raise exception 'too late to cancel'; end if;
  elsif not has_role('platform_admin') then
    raise exception 'not authorized';
  elsif v_order.status = 'cancelled' then return; end if;

  update public.orders set status = 'cancelled', cancellation_reason = p_reason where id = p_order_id;
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where order_id = p_order_id and status = 'offered';

  -- #4: if we cancelled an in-flight order, release the courier back to online.
  if v_order.status in ('courier_assigned', 'picked_up', 'en_route') and v_order.courier_id is not null then
    update public.couriers set status = 'online' where id = v_order.courier_id and status = 'on_delivery';
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'cancelled', case when has_role('platform_admin') then 'platform_admin' else 'customer' end, auth.uid(), p_reason);
end;
$$;

-- ============================================================================
-- #4-data (MED) admin_restaurant_kpis mixed catering (customer-confirmed days
-- later) into restaurant acceptance KPIs. Scope to standard orders.
-- ============================================================================
create or replace view public.admin_restaurant_kpis
with (security_invoker = on) as
select
  r.id, r.name, r.is_active, r.accepting_orders, r.accept_sla_minutes,
  count(o.id) as orders_7d,
  count(*) filter (where acc.accepted_at is not null) as accepted_7d,
  count(*) filter (where rej.rejected_at is not null) as rejected_7d,
  count(*) filter (where sys.auto_cancelled_at is not null) as auto_cancelled_7d,
  round(
    count(*) filter (where acc.accepted_at is not null)::numeric
    / nullif(count(*) filter (where acc.accepted_at is not null or rej.rejected_at is not null or sys.auto_cancelled_at is not null), 0),
    3
  ) as acceptance_rate_7d,
  round(avg(extract(epoch from (acc.accepted_at - o.created_at)) / 60.0)::numeric, 1) as avg_accept_minutes_7d
from public.restaurants r
left join public.orders o
  on o.restaurant_id = r.id and o.order_type = 'standard' and o.created_at > now() - interval '7 days'
left join lateral (
  select min(e.created_at) as accepted_at from public.delivery_status_events e
  where e.order_id = o.id and e.status = 'accepted'
) acc on true
left join lateral (
  select min(e.created_at) as rejected_at from public.delivery_status_events e
  where e.order_id = o.id and e.status = 'rejected'
) rej on true
left join lateral (
  select min(e.created_at) as auto_cancelled_at from public.delivery_status_events e
  where e.order_id = o.id and e.status = 'cancelled' and e.actor_role = 'system'
) sys on true
group by r.id, r.name, r.is_active, r.accepting_orders, r.accept_sla_minutes;

-- ============================================================================
-- #5-data (LOW) courier_location_guard flagged stationary GPS jitter as a
-- teleport (elapsed floored at 1s, no distance floor). Mirror WS10's floors.
-- ============================================================================
create or replace function public.courier_location_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_speed_kmh double precision;
  v_dist_km double precision;
  v_elapsed_s double precision;
begin
  if new.lat not between 45.4 and 48.5 or new.lng not between 26.6 and 30.2 then
    raise exception 'coordinates outside service area';
  end if;
  new.is_plausible := true;
  if tg_op = 'UPDATE' then
    v_elapsed_s := extract(epoch from (now() - old.updated_at));
    v_dist_km := extensions.st_distance(
        extensions.st_setsrid(extensions.st_makepoint(new.lng::float8, new.lat::float8), 4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(old.lng::float8, old.lat::float8), 4326)::extensions.geography
      ) / 1000.0;
    -- jitter floors (mirror WS10 20260717001700): ignore near-simultaneous /
    -- sub-300m GPS scatter that would otherwise read as an implausible speed.
    if v_elapsed_s >= 5 and v_dist_km >= 0.3 then
      v_speed_kmh := v_dist_km / (v_elapsed_s / 3600.0);
      if v_speed_kmh > 150 then new.is_plausible := false; end if;
    end if;
  end if;
  return new;
end;
$$;
