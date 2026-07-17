-- Hardening pass — fixes 6 defects confirmed by the adversarial backtest workflow
-- (wf_a6f1042e). Each fix is minimal and preserves existing behavior otherwise.

-- ============================================================================
-- #1 (HIGH) confirm_catering_quote revives a cancelled/rejected order.
-- It checked caller + quote_status='quoted' but NEVER orders.status, so a
-- terminal order whose quote_status is still 'quoted' could be driven back to
-- 'accepted'. Add FOR UPDATE + an order-status transition guard.
-- ============================================================================
create or replace function public.confirm_catering_quote(p_order_id uuid)
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
  if not found or v_order.customer_id <> auth.uid() then raise exception 'not authorized'; end if;
  -- transition guard: the only valid pre-acceptance state (blocks cancelled/rejected/accepted revival)
  if v_order.status <> 'pending_restaurant' then
    raise exception 'invalid transition from % — comanda nu mai poate fi confirmată', v_order.status;
  end if;

  select * into v_details from public.catering_details where order_id = p_order_id;
  if not found or v_details.quote_status <> 'quoted' then raise exception 'no active quote to confirm'; end if;

  update public.catering_details set quote_status = 'confirmed' where order_id = p_order_id;
  update public.orders set status = 'accepted', total_mdl = v_details.quoted_total_mdl where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'accepted', 'customer', auth.uid());
end;
$$;

-- ============================================================================
-- #2 (HIGH) A restaurant partner could forge the public rating_avg/rating_count
-- via direct UPDATE (RLS scopes rows, not columns; authenticated has table-level
-- UPDATE). Guard the denormalized aggregates: revert any change unless the writer
-- bypasses RLS (i.e. the SECURITY DEFINER submit_rating running as the table owner).
-- A client role (authenticated/anon) can never bypass RLS, so it can never move them.
-- ============================================================================
-- SECURITY INVOKER (default, NOT definer): a definer trigger would always run as
-- its owner and current_user would always be postgres, defeating the check. As
-- invoker, current_user is the real writer — postgres when fired from the definer
-- submit_rating, authenticated on a direct client UPDATE.
create or replace function public.guard_rating_columns()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_privileged boolean;
begin
  select coalesce(bool_or(rolbypassrls or rolsuper), false) into v_privileged
  from pg_roles where rolname = current_user;
  if v_privileged then
    return new; -- submit_rating (definer, runs as owner) writes the real aggregates
  end if;
  new.rating_avg := old.rating_avg;
  new.rating_count := old.rating_count;
  return new;
end;
$$;

drop trigger if exists restaurants_guard_ratings on public.restaurants;
create trigger restaurants_guard_ratings
  before update on public.restaurants
  for each row execute function public.guard_rating_columns();

drop trigger if exists couriers_guard_ratings on public.couriers;
create trigger couriers_guard_ratings
  before update on public.couriers
  for each row execute function public.guard_rating_columns();

-- ============================================================================
-- #4 (MEDIUM) Capacity TOCTOU: two concurrent same-courier claims on DIFFERENT
-- orders both passed the courier_has_capacity SELECT (no courier-level lock), so
-- a courier could be assigned two orders at once. Fix: take the courier row lock
-- FIRST in every claim RPC (courier→order ordering; advance is order→courier but
-- operates on already-held orders, so no cross-cycle). The second concurrent
-- claim blocks on the courier lock, then re-checks capacity post-commit and fails.
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
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;
  perform 1 from public.couriers where id = v_courier_id for update; -- #4: serialize same-courier claims

  select * into v_offer from public.dispatch_offers where id = p_offer_id for update;
  if not found or v_offer.courier_id <> v_courier_id then raise exception 'offer not found'; end if;
  if v_offer.status = 'accepted' then return; end if;
  if v_offer.status <> 'offered' or v_offer.expires_at <= now() then
    raise exception 'oferta a expirat';
  end if;
  if not public.courier_has_capacity(v_courier_id) then
    raise exception 'you already have an active delivery';
  end if;

  update public.orders
  set status = 'courier_assigned', courier_id = v_courier_id
  where id = v_offer.order_id and status = 'ready_for_pickup' and courier_id is null;
  if not found then
    update public.dispatch_offers set status = 'cancelled', responded_at = now() where id = p_offer_id;
    raise exception 'comanda nu mai este disponibila';
  end if;

  update public.dispatch_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update public.couriers set status = 'on_delivery' where id = v_courier_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (v_offer.order_id, 'courier_assigned', 'courier', auth.uid());
end;
$$;

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
  perform 1 from public.couriers where id = v_courier_id for update; -- #4: serialize same-courier claims

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
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where order_id = p_order_id and status = 'offered';

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'courier_assigned', 'courier', auth.uid());
end;
$$;

-- ============================================================================
-- #5 (MEDIUM) An unhandled unique_violation from dispatch_offers_live_per_courier
-- (a courier already has a live offer when dispatch_order fires) aborted the whole
-- decline / sweeper tick. Wrap each dispatch_order call so a collision is a no-op
-- (next tick / next cascade recovers) — mirrors the guard in mark_ready_for_pickup.
-- ============================================================================
create or replace function public.decline_dispatch_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_offer public.dispatch_offers%rowtype;
  v_courier_id uuid;
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;

  select * into v_offer from public.dispatch_offers where id = p_offer_id for update;
  if not found or v_offer.courier_id <> v_courier_id then raise exception 'offer not found'; end if;
  if v_offer.status = 'declined' then return; end if;
  if v_offer.status <> 'offered' then raise exception 'oferta nu mai este activa'; end if;

  update public.dispatch_offers set status = 'declined', responded_at = now() where id = p_offer_id;
  begin
    perform public.dispatch_order(v_offer.order_id); -- immediate cascade
  exception when unique_violation then null; -- another wave/courier raced; sweeper recovers
  end;
end;
$$;

create or replace function public.expire_dispatch_offers()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_count int := 0;
begin
  for v_rec in
    with expired as (
      update public.dispatch_offers
      set status = 'expired', responded_at = now()
      where status = 'offered' and expires_at < now()
      returning order_id
    ) select order_id from expired
  loop
    begin
      perform public.dispatch_order(v_rec.order_id);
    exception when unique_violation then null; -- one collision must not abort the whole tick
    end;
    v_count := v_count + 1;
  end loop;

  for v_rec in
    select o.id as order_id from public.orders o
    where o.status = 'ready_for_pickup' and o.courier_id is null
      and not exists (select 1 from public.dispatch_offers d
                      where d.order_id = o.id and d.status = 'offered')
  loop
    begin
      perform public.dispatch_order(v_rec.order_id);
    exception when unique_violation then null;
    end;
  end loop;
  return v_count;
end;
$$;

-- ============================================================================
-- #8 (LOW) admin_order_board.in_state_since used the last event of ANY kind, so a
-- same-status payment-note event (from admin_update_payment_status) reset the age
-- and could hide a stuck order. The lifecycle is forward-only, so time-in-current-
-- status = the earliest event matching the current status. Recreate the view.
-- (Column list/order unchanged → dependent admin_stuck_orders stays valid.)
-- ============================================================================
create or replace view public.admin_order_board
with (security_invoker = on) as
select
  o.id, o.order_number, o.order_type, o.status,
  o.payment_method, o.payment_status, o.total_mdl,
  o.created_at, o.notes,
  o.restaurant_id, r.name as restaurant_name, r.accept_sla_minutes, r.avg_prep_minutes,
  o.courier_id, c.full_name as courier_name, c.status as courier_status,
  a.street_address, a.sector, a.lat as delivery_lat, a.lng as delivery_lng,
  coalesce(ev.entered_at, o.created_at) as in_state_since,
  extract(epoch from (now() - coalesce(ev.entered_at, o.created_at)))::int as in_state_seconds
from public.orders o
join public.restaurants r on r.id = o.restaurant_id
left join public.couriers c on c.id = o.courier_id
left join public.addresses a on a.id = o.delivery_address_id
left join lateral (
  -- time-in-current-status: earliest event whose status = the order's status
  select min(e.created_at) as entered_at
  from public.delivery_status_events e
  where e.order_id = o.id and e.status = o.status
) ev on true
where o.status not in ('delivered', 'cancelled', 'rejected');

-- ============================================================================
-- #6 (MEDIUM) admin_stuck_orders false-flagged catering orders: a catering order
-- legitimately sits in pending_restaurant (awaiting quote) / accepted (event
-- scheduled far out), and got flagged as "SLA depășit / prep peste timp". Scope
-- the restaurant-timing branches (pending_restaurant, accepted) to standard orders;
-- the courier-timing branches apply to any order actually out for delivery.
-- ============================================================================
create or replace view public.admin_stuck_orders
with (security_invoker = on) as
select b.*,
  case
    when b.status = 'pending_restaurant' then 'SLA depășit — sweeper-ul pg_cron nu a rulat'
    when b.status = 'accepted'           then 'Pregătire peste timpul estimat'
    when b.status = 'ready_for_pickup'   then 'Niciun curier nu a preluat comanda'
    when b.status = 'courier_assigned'   then 'Curierul nu a ridicat comanda'
    else 'Livrare care durează prea mult'
  end as stuck_reason
from public.admin_order_board b
where
     (b.order_type = 'standard' and b.status = 'pending_restaurant' and b.in_state_seconds > b.accept_sla_minutes * 60 + 120)
  or (b.order_type = 'standard' and b.status = 'accepted'           and b.in_state_seconds > (b.avg_prep_minutes + 15) * 60)
  or (b.status = 'ready_for_pickup'   and b.in_state_seconds > 15 * 60)
  or (b.status = 'courier_assigned'   and b.in_state_seconds > 15 * 60)
  or (b.status in ('picked_up', 'en_route') and b.in_state_seconds > 45 * 60);
