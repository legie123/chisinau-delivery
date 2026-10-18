-- Rollback of 20261012000213_courier_security_fixes (bodies = LIVE before 213, via pg_get_functiondef).
set local lock_timeout = '5s';
revoke all on public.available_orders_for_couriers from authenticated, viewer;
drop view if exists public.available_orders_for_couriers;
drop policy if exists courier_locations_self_read on public.courier_locations;
drop policy if exists courier_locations_self_insert on public.courier_locations;
drop policy if exists courier_locations_self_update on public.courier_locations;
create policy courier_locations_self_all on public.courier_locations
  to authenticated, viewer
  using (courier_id = (select public.current_courier_id()))
  with check (courier_id = (select public.current_courier_id()));
drop policy if exists orders_courier_read_unassigned on public.orders;
create policy orders_courier_read_unassigned on public.orders
  for select to authenticated, viewer
  using (status = 'ready_for_pickup' and courier_id is null and (select public.has_role('courier')));
grant execute on function public.courier_has_capacity(uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.courier_location_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.accept_dispatch_offer(p_offer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_offer public.dispatch_offers%rowtype;
  v_courier_id uuid;
  v_order_id uuid;
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;
  perform 1 from public.couriers where id = v_courier_id for no key update;                 -- (1) courier

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
  update public.couriers set status = 'on_delivery', consecutive_ignored_offers = 0 where id = v_courier_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (v_offer.order_id, 'courier_assigned', 'courier', auth.uid());
exception
  -- #1 fix: a sweeper-vs-accept deadlock at the expiry boundary means the offer
  -- was being expired out from under us — surface it as the calm offer-gone UX.
  when deadlock_detected then raise exception 'oferta a expirat';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_courier(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_order public.orders%rowtype;
  v_courier_id uuid;
  v_status text;
begin
  select id, status into v_courier_id, v_status from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;
  perform 1 from public.couriers where id = v_courier_id for no key update;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.courier_id = v_courier_id and v_order.status = 'courier_assigned' then return; end if;

  if not public.courier_has_capacity(v_courier_id) then
    raise exception 'you already have an active delivery';
  end if;
  -- The pull path used to skip every gate dispatch_order enforces (verifier, 2026-10-04): an OFFLINE
  -- courier (no open shift) could claim, a catering order scheduled for tomorrow could be claimed
  -- today, and the cash-aware gate was bypassed.
  if v_status <> 'online' then
    raise exception 'treci pe online ca să poți prelua comenzi';
  end if;
  if v_order.requested_for is not null and v_order.requested_for > now() + interval '45 minutes' then
    raise exception 'comandă programată: poate fi preluată cu cel mult 45 de minute înainte';
  end if;
  if v_order.payment_method = 'cash' and v_order.order_type = 'standard'
     and public.courier_cash_balance(v_courier_id) + v_order.total_mdl >= public.effective_cash_cap(v_courier_id) then
    raise exception 'plafonul de numerar al curierului ar fi depășit de această comandă';
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
$function$
;
