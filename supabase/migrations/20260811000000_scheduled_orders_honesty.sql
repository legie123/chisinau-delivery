-- Audit 2026-08-11 CRIT: scheduled orders ("Programează livrarea") were treated
-- as live ASAP orders end-to-end. Two DB-level dishonesties fixed here (the UI
-- surfaces that render requested_for ship in the same wave, app-side):
--
-- 1. expire_stale_orders cancelled a scheduled-for-tomorrow order minutes after
--    placement: the accept-SLA clock always anchored on created_at. For orders
--    with a future requested_for, the clock now anchors 60 min before the
--    window — the restaurant confirms when the order becomes operationally
--    relevant, not at midnight for tomorrow's lunch.
--
-- 2. dispatch_order offered scheduled orders as soon as the restaurant marked
--    them ready (~14h early in the audit repro). Every dispatch path funnels
--    through dispatch_order (mark_ready_for_pickup, the sweeper's cascade AND
--    its rescue scan), so ONE guard at the top holds the order until 45 min
--    before the window. The order can sit ready_for_pickup; the sweeper's
--    rescue scan re-calls dispatch_order every 15s and opens the gate on time.
--
-- Recreated from the LIVE function bodies (pg_get_functiondef), minimal diffs.

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
$function$;
