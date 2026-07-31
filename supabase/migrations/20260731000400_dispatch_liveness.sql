-- DispatchAudit (adversarial, 2026-07-31) — 2 liveness bugs. Read against LIVE
-- pg_get_functiondef bodies; recreations are byte-identical except the fixes.
--
-- #2 HIGH (confirmed: 2 orders stuck in ready_for_pickup since 2026-07-27):
-- dispatch_order's wave cap counts max(wave) over ALL historical offers, so once
-- 5 waves are spent it computes v_wave=6 forever and the sweeper's rescue loop
-- can never place the order again — even to a courier who came online later and
-- was never offered it. "Sweeper re-tries" was dead code. FIX: scope the wave
-- budget to a 5-minute round window. A rapid decline/expiry burst (seconds) still
-- caps at 5 waves; once the order goes quiet for >5 min, a newly-available
-- courier gets a fresh wave-1 attempt — automated recovery below the 15-min
-- admin_stuck_orders human net. (The per-order-per-courier exclusion stays
-- lifetime — dispatch_offers_order_courier_once forbids re-offering the same
-- courier anyway, so recovery genuinely needs a new courier.)
--
-- #1 HIGH (deadlock, lock-order inversion sweeper[offer-first] vs
-- accept[courier→order→offer]/decline[order→offer]): under concurrency a courier
-- tapping Accept/Decline at the 30s boundary vs the 15s sweeper can deadlock;
-- Postgres aborts one side. Neither accept/decline caught deadlock_detected
-- (40P01) → raw 500 to the courier instead of the calm "offer gone" UX, and a
-- sweeper victim rolled back its whole tick. FIX: catch deadlock in accept/
-- decline → re-raise as the app's own "expired" message (OfferCard treats it as
-- offer-gone), and add deadlock_detected to the sweeper's per-cascade catch so a
-- single collision degrades gracefully instead of losing the tick.

create or replace function public.dispatch_order(p_order_id uuid)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_order public.orders%rowtype;
  v_cand record;
  v_wave int;
  v_offer_id uuid;
  v_cfg public.dispatch_scoring_config;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    return null;
  end if;
  if exists (select 1 from public.dispatch_offers where order_id = p_order_id and status = 'offered') then
    return null;
  end if;

  -- #2 fix: wave budget is per ROUND (last 5 min), not per lifetime. A quiet
  -- order resets to wave 1; a burst still caps at 5.
  select coalesce(max(wave), 0) + 1 into v_wave from public.dispatch_offers
    where order_id = p_order_id and created_at > now() - interval '5 minutes';
  if v_wave > 5 then
    return null;
  end if;

  select * into v_cfg from public.current_dispatch_scoring_config();

  -- Anonymity invariant: score is ETA-to-restaurant only. No acceptance/
  -- decline history term — deleted, not zeroed (see header).
  select c.id as courier_id, d.dist_km,
         round(d.dist_km / v.speed_kmh * 60 * v_cfg.alpha0, 2) as score
  into v_cand
  from public.couriers c
  join public.restaurants r on r.id = v_order.restaurant_id
  left join public.courier_locations cl
    on cl.courier_id = c.id and cl.updated_at > now() - interval '10 minutes' and cl.is_plausible
  cross join lateral (
    select case c.vehicle_type
      when 'bike' then 12 when 'e_bike' then 18 when 'scooter' then 25
      when 'car' then 22 else 5 end::numeric as speed_kmh
  ) v
  cross join lateral (
    select coalesce(public.haversine_km(cl.lat, cl.lng, r.lat, r.lng), 6.0) as dist_km
  ) d
  where c.status = 'online' and c.is_active
    and public.courier_has_capacity(c.id)
    and not exists (select 1 from public.dispatch_offers lo
                    where lo.courier_id = c.id and lo.status = 'offered')
    -- Lifetime exclusion stays (dispatch_offers_order_courier_once is a hard
    -- unique on (order_id, courier_id) — a courier can never be re-offered the
    -- same order, so recovery of a fully-canvassed order depends on a NEW
    -- courier coming online, which the windowed wave budget above now permits).
    and not exists (select 1 from public.dispatch_offers po
                    where po.courier_id = c.id and po.order_id = p_order_id)
  order by score asc
  limit 1;

  if v_cand.courier_id is null then
    return null;
  end if;

  insert into public.dispatch_offers (order_id, courier_id, wave, score, distance_km, expires_at)
  values (p_order_id, v_cand.courier_id, v_wave, v_cand.score, v_cand.dist_km, now() + interval '30 seconds')
  returning id into v_offer_id;
  return v_offer_id;
end;
$$;
revoke execute on function public.dispatch_order(uuid) from public, anon, authenticated;

-- accept: catch deadlock → calm "expirat" (OfferCard.isOfferGoneMessage matches).
create or replace function public.accept_dispatch_offer(p_offer_id uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'auth'
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
  update public.couriers set status = 'on_delivery', consecutive_ignored_offers = 0 where id = v_courier_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (v_offer.order_id, 'courier_assigned', 'courier', auth.uid());
exception
  -- #1 fix: a sweeper-vs-accept deadlock at the expiry boundary means the offer
  -- was being expired out from under us — surface it as the calm offer-gone UX.
  when deadlock_detected then raise exception 'oferta a expirat';
end;
$$;
revoke execute on function public.accept_dispatch_offer(uuid) from public, anon;
grant execute on function public.accept_dispatch_offer(uuid) to authenticated;

-- decline: same deadlock → calm "nu mai este activa".
create or replace function public.decline_dispatch_offer(p_offer_id uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'auth'
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
  exception when unique_violation then null; when deadlock_detected then null;
  end;
exception
  when deadlock_detected then raise exception 'oferta nu mai este activa';
end;
$$;
revoke execute on function public.decline_dispatch_offer(uuid) from public, anon;
grant execute on function public.decline_dispatch_offer(uuid) to authenticated;

-- sweeper: add deadlock_detected to both cascade catches — one collision must
-- not roll back the whole tick's expiries + ghost updates. Otherwise byte-identical.
create or replace function public.expire_dispatch_offers()
returns integer
language plpgsql security definer
set search_path to 'public'
set statement_timeout to '30s'
as $$
declare
  v_rec record;
  v_count int := 0;
  v_streak int;
  v_courier_user uuid;
begin
  for v_rec in
    with expired as (
      update public.dispatch_offers
      set status = 'expired', responded_at = now()
      where status = 'offered' and expires_at < now()
      returning order_id, courier_id
    ) select order_id, courier_id from expired
  loop
    update public.couriers
    set consecutive_ignored_offers = consecutive_ignored_offers + 1
    where id = v_rec.courier_id
    returning consecutive_ignored_offers into v_streak;

    if v_streak >= 3 then
      update public.courier_shifts set ended_at = now()
      where courier_id = v_rec.courier_id and ended_at is null;

      update public.dispatch_offers set status = 'declined', responded_at = now()
      where courier_id = v_rec.courier_id and status = 'offered';

      update public.couriers set status = 'offline', consecutive_ignored_offers = 0
      where id = v_rec.courier_id
      returning user_id into v_courier_user;

      if v_courier_user is not null then
        insert into public.notification_outbox (user_id, title, body, url, tag)
        values (
          v_courier_user,
          'Trecut offline automat',
          'Te-am trecut offline după 3 oferte ratate — revino online când ești gata.',
          '/deliveries',
          'dispatch'
        );
      end if;
    end if;

    begin
      perform public.dispatch_order(v_rec.order_id);
    exception when unique_violation then null; when deadlock_detected then null;
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
    exception when unique_violation then null; when deadlock_detected then null;
    end;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.expire_dispatch_offers() from public, anon, authenticated;

-- SurfaceAudit P2: admin can rescue a ready_for_pickup order that has NO courier
-- (admin_reassign_courier only handles orders that already have one). Mirrors it
-- for the courier_id IS NULL case.
create or replace function public.admin_assign_courier(p_order_id uuid, p_new_courier_id uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'auth'
as $$
declare
  v_order public.orders%rowtype;
  v_new public.couriers%rowtype;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    raise exception 'comanda nu e liberă de atribuit (stare %, curier %)',
      v_order.status, coalesce(v_order.courier_id::text, '—');
  end if;

  select * into v_new from public.couriers where id = p_new_courier_id for update;
  if not found or not v_new.is_active then raise exception 'curierul nu este disponibil'; end if;
  if not public.courier_has_capacity(p_new_courier_id) then
    raise exception 'curierul are deja o livrare activă';
  end if;

  update public.orders
    set status = 'courier_assigned', courier_id = p_new_courier_id, courier_arrived_restaurant_at = null
    where id = p_order_id;
  update public.couriers set status = 'on_delivery' where id = p_new_courier_id;

  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where order_id = p_order_id and status = 'offered';

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'courier_assigned', 'platform_admin', auth.uid(),
          format('atribuit manual curier: %s', p_new_courier_id::text));
end;
$$;
revoke execute on function public.admin_assign_courier(uuid, uuid) from public, anon;
grant execute on function public.admin_assign_courier(uuid, uuid) to authenticated;
