-- Audit 2026-08-11 HIGH: single-courier dispatch dead-end. The hard unique
-- index dispatch_offers_order_courier_once made "never re-offer the same
-- courier" a LIFETIME rule per order — with one online courier (the pilot
-- reality), one missed 30s offer removed the order from the automatic pool
-- forever ("recovery depends on a NEW courier coming online").
--
-- New rule, enforced in dispatch_order()'s candidate query:
--   - offered  -> excluded (a live offer exists anyway)
--   - declined -> excluded forever (an explicit no is respected — declines
--                 also never count toward ghost auto-offline, unchanged)
--   - expired  -> excluded only for a 2-minute cooldown, then eligible again
--                 (a missed push is not a refusal; repeated ignores still trip
--                 the ghost auto-offline at 3 and take the courier offline)
--
-- The unique index becomes a plain lookup index: per-order/per-courier live
-- uniqueness is already guaranteed by dispatch_offers_live_per_order /
-- dispatch_offers_live_per_courier (partial uniques on status='offered').

drop index if exists public.dispatch_offers_order_courier_once;
create index if not exists dispatch_offers_order_courier_idx
  on public.dispatch_offers (order_id, courier_id);

-- COMPANION FIX (required by the cooldown): under the lifetime rule, a ready
-- order whose only courier had one expired offer went silent forever. Under
-- cooldown it does the opposite — a ZOMBIE ready_for_pickup order (courier
-- never found, e.g. seeded weeks ago) would hunt the online courier with a
-- fresh offer every ~2 minutes for eternity via the sweeper rescue. Ready
-- orders that never found a courier now expire after 6 hours (food staged
-- 6h ago is not deliverable); scheduled orders are exempt while their window
-- (+2h grace) is still relevant.
create or replace function public.expire_stale_orders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
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
      -- scheduled orders: SLA clock starts 60 min before the requested window,
      -- never before placement (past/near requested_for degrades to ASAP behavior)
      and greatest(o.created_at, coalesce(o.requested_for - interval '60 minutes', o.created_at))
          < now() - make_interval(mins => r.accept_sla_minutes)
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

  -- Zombie ready orders: ready_for_pickup, no courier, ready-state entered
  -- over 6h ago, and no future scheduled window that still justifies waiting.
  for v_expired in
    select o.id
    from public.orders o
    where o.status = 'ready_for_pickup'
      and o.courier_id is null
      and coalesce(o.requested_for + interval '2 hours', now() - interval '100 years') < now()
      and coalesce(
            (select max(e.created_at) from public.delivery_status_events e
             where e.order_id = o.id and e.status = 'ready_for_pickup'),
            o.created_at
          ) < now() - interval '6 hours'
  loop
    update public.orders
    set status = 'cancelled',
        cancellation_reason = 'Nu am găsit un curier disponibil — anulare automată. Ne pare rău.'
    where id = v_expired.id and status = 'ready_for_pickup' and courier_id is null;
    if found then
      insert into public.delivery_status_events (order_id, status, actor_role, note)
      values (v_expired.id, 'cancelled', 'system', 'no courier found — ready-order timeout');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.dispatch_order(p_order_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- Scheduled order: hold every dispatch path until 45 min before the window.
  -- The 15s sweeper rescue re-calls this function, so the gate opens on time.
  if v_order.requested_for is not null and v_order.requested_for > now() + interval '45 minutes' then
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
    -- Cooldown exclusion (was: lifetime). Declines are a permanent no; an
    -- expired (ignored) offer only sidelines the courier for 2 minutes.
    and not exists (select 1 from public.dispatch_offers po
                    where po.courier_id = c.id and po.order_id = p_order_id
                      and (po.status in ('offered','accepted','declined')
                           or (po.status = 'expired'
                               and po.expires_at > now() - interval '2 minutes')))
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
$function$;
