-- Courier security fixes (audit 2026-10-18, findings #2 #5 #6 #4 #15). Sim 161.
-- #2  courier_locations: the courier could DELETE its own row and INSERT a new one with updated_at in the
--     future and the restaurant's coordinates -> permanent "live <2 min" in dispatch_order, distance 0 in
--     assign_courier, and no teleport check (both speed checks only see UPDATE, set_updated_at only UPDATE).
--     - courier_locations_self_all (ALL) split: SELECT / INSERT / UPDATE, NO DELETE for the courier. Without a
--       delete every later write is an UPDATE, so check_gps_plausibility + the guard's speed branch always run.
--     - INSERT/UPDATE WITH CHECK: own row, active courier (#5), updated_at <= now() + 1 minute.
--     - courier_location_guard (LIVE body, last defined in 20260717002400; one delta): on INSERT by a client role
--       (authenticated / viewer / anon) updated_at := now() — the client's value is ignored. Server roles
--       (postgres, service_role, security definer code) keep an explicit updated_at (sims seed stale points).
--     The web (useBroadcastCourierLocation) and mobile (upsertMyLocation, backgroundLocation) heartbeats are
--     upserts (INSERT .. ON CONFLICT DO UPDATE) of courier_id, lat, lng[, accuracy_m]: still allowed.
-- #5  orders_courier_read_unassigned also requires couriers.is_active (a deactivated courier keeps the
--     'courier' role). couriers has no 'suspended' status (check: offline/online/on_delivery).
-- #6  view available_orders_for_couriers (security_barrier, owner rights): the pre-accept list with ONLY the
--     columns the list needs — no notes, customer_id, idempotency_key, request_fingerprint. Same filter as the
--     policy + active courier. The raw orders policy is NOT narrowed yet: web + mobile still read orders
--     directly; it is tightened in a later migration once both consumers moved (CROSS-REQUESTS).
-- #4  assign_courier / accept_dispatch_offer (LIVE bodies, one delta each): when courier_has_capacity() is
--     false only because of the cash cap, the error is the cap, not "you already have an active delivery".
--     No amount changes.
-- #15 courier_has_capacity(uuid): revoke EXECUTE from authenticated (only security definer RPCs call it:
--     dispatch_order, accept_dispatch_offer, assign_courier, admin_assign_courier, admin_reassign_courier;
--     no client surface in src/, mobile/, packages/).
-- ROLLBACK: supabase/rollbacks/20261012000213_courier_security_fixes.down.sql

set local lock_timeout = '5s';

-- ===== #2 + #5: courier_locations =====
drop policy if exists courier_locations_self_all on public.courier_locations;
create policy courier_locations_self_read on public.courier_locations
  for select to authenticated, viewer
  using (courier_id = (select public.current_courier_id()));
create policy courier_locations_self_insert on public.courier_locations
  for insert to authenticated, viewer
  with check (
    courier_id = (select public.current_courier_id())
    and updated_at <= now() + interval '1 minute'
    and exists (select 1 from public.couriers c where c.user_id = (select auth.uid()) and c.is_active)
  );
create policy courier_locations_self_update on public.courier_locations
  for update to authenticated, viewer
  using (courier_id = (select public.current_courier_id()))
  with check (
    courier_id = (select public.current_courier_id())
    and updated_at <= now() + interval '1 minute'
    and exists (select 1 from public.couriers c where c.user_id = (select auth.uid()) and c.is_active)
  );

create or replace function public.courier_location_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'extensions'
as $function$
declare
  v_speed_kmh double precision;
  v_dist_km double precision;
  v_elapsed_s double precision;
begin
  if new.lat not between 45.4 and 48.5 or new.lng not between 26.6 and 30.2 then
    raise exception 'coordinates outside service area';
  end if;
  new.is_plausible := true;
  -- #2 (20261012000213): a client never chooses its own freshness (set_updated_at covers UPDATE).
  if tg_op = 'INSERT' and current_user in ('authenticated', 'viewer', 'anon') then
    new.updated_at := now();
  end if;
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
$function$;

-- ===== #5: unassigned orders only for an ACTIVE courier =====
drop policy if exists orders_courier_read_unassigned on public.orders;
create policy orders_courier_read_unassigned on public.orders
  for select to authenticated, viewer
  using (
    status = 'ready_for_pickup' and courier_id is null
    and (select public.has_role('courier'))
    and exists (select 1 from public.couriers c where c.user_id = (select auth.uid()) and c.is_active)
  );

-- ===== #6: pre-accept list without PII =====
create view public.available_orders_for_couriers with (security_barrier = true) as
select o.id, o.order_number, o.order_type, o.restaurant_id, o.delivery_address_id, o.status,
       o.payment_method, o.total_mdl, o.delivery_fee_mdl, o.tip_mdl, o.courier_fee_quoted_mdl,
       o.courier_fee_mdl, o.courier_fee_surcharge_mdl, o.requested_for, o.estimated_ready_at, o.created_at
from public.orders o
where o.status = 'ready_for_pickup' and o.courier_id is null
  and exists (select 1 from public.couriers c where c.user_id = auth.uid() and c.is_active)
  -- owner rights skip the RESTRICTIVE viewer_session_live policy on orders: re-check it here (sim 73)
  and (current_user <> 'viewer' or public.viewer_session_live());
comment on view public.available_orders_for_couriers is
  'Comenzi disponibile pentru curierii activi, fără notes/customer_id/idempotency_key/request_fingerprint (20261012000213).';
-- a one-table view is auto-updatable: no write grant for anyone; read for authenticated + viewer (parity, sim 73)
revoke all on public.available_orders_for_couriers from public, anon, authenticated, viewer;
grant select on public.available_orders_for_couriers to authenticated, viewer;

-- ===== #4: cash cap is its own error =====
create or replace function public.accept_dispatch_offer(p_offer_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
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
  if not public.courier_has_capacity(v_courier_id) then
    if exists (select 1 from public.orders where courier_id = v_courier_id
               and status in ('courier_assigned', 'picked_up', 'en_route')) then
      raise exception 'you already have an active delivery';
    end if;
    raise exception 'Plafon numerar atins — predă încasările înainte să preiei comenzi.';
  end if;

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
$function$;

create or replace function public.assign_courier(p_order_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
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
    if exists (select 1 from public.orders where courier_id = v_courier_id
               and status in ('courier_assigned', 'picked_up', 'en_route')) then
      raise exception 'you already have an active delivery';
    end if;
    raise exception 'Plafon numerar atins — predă încasările înainte să preiei comenzi.';
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
$function$;

-- ===== #15 =====
revoke execute on function public.courier_has_capacity(uuid) from public, anon, authenticated;
