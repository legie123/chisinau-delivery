-- Fixes after verif-curier round 5 on 20261012000209 (no amount changes).
--
-- 1. "Re-dispatched never to the same courier" was false for orders an admin assigned (admin_assign_courier /
--    admin_reassign_courier leave no dispatch_offers row, and dispatch_order only skipped a courier with an
--    offered/accepted/declined/recent-expired offer on the order): the courier who had just said "vehicle problem"
--    got the same order back at once, and ignoring it counted as an ignored offer. dispatch_order (from its live
--    body, one delta) now also skips a courier who released THIS order. It is a per-order exclusion like a
--    decline, not a score: no ranking reads releases (EU 2024/2831, docs/plan/CONSTRANGERI-GAMIFICARE.md).
-- 2. A release replayed after a lost response errored ("Comanda nu îți este atribuită.") after a success.
--    courier_release_order (live body, one delta) now answers a replay by the same courier with the same
--    "left today" number and writes nothing.
-- Note: a release writes a new ready_for_pickup event, which restarts the no-courier auto-cancel and stuck clocks
-- for that order (expire_stale_orders and admin_stuck_orders read the latest event). Intended: the order is new
-- for the next courier.
-- ROLLBACK: supabase/rollbacks/20261012000210_release_exclusion.down.sql
CREATE OR REPLACE FUNCTION public.dispatch_order(p_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if v_order.requested_for is not null and v_order.requested_for > now() + interval '45 minutes' then
    return null;
  end if;
  if exists (select 1 from public.dispatch_offers where order_id = p_order_id and status = 'offered') then
    return null;
  end if;

  select coalesce(max(wave), 0) + 1 into v_wave from public.dispatch_offers
    where order_id = p_order_id and created_at > now() - interval '5 minutes';
  if v_wave > 5 then
    return null;
  end if;

  select * into v_cfg from public.current_dispatch_scoring_config();

  select c.id as courier_id, d.dist_km,
         -- Unknown position: scored as 6.0 km so it still ranks among the stale ones, but
         -- stored as null (both apps show "Distanță estimată" instead of a made-up 6.0 km).
         round(coalesce(d.dist_km, 6.0) / v.speed_kmh * 60 * v_cfg.alpha0, 2) as score
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
    select public.haversine_km(cl.lat, cl.lng, r.lat, r.lng) as dist_km,
           -- 0 live (2 min, as nearby_available_couriers), 1 recent (10 min), 2 no position
           case when cl.updated_at > now() - interval '2 minutes' then 0
                when cl.courier_id is not null then 1 else 2 end as tier
  ) d
  cross join lateral (
    select max(lo.created_at) as last_offered_at from public.dispatch_offers lo where lo.courier_id = c.id  -- dispatch_offers_courier_hist_idx
  ) lo
  where c.status = 'online' and c.is_active
    and public.courier_has_capacity(c.id)
    -- Cash-aware capacity (STANDARD only; >= matches the punishment trigger).
    -- Catering cash is exempt: it exceeds every cap by construction and its
    -- settlement is a business-process question, not a dispatch one.
    and not (
      v_order.payment_method = 'cash'
      and v_order.order_type = 'standard'
      and public.courier_cash_balance(c.id) + v_order.total_mdl >= public.effective_cash_cap(c.id)
    )
    and not exists (select 1 from public.dispatch_offers lo
                    where lo.courier_id = c.id and lo.status = 'offered')
    and not exists (select 1 from public.dispatch_offers po
                    where po.courier_id = c.id and po.order_id = p_order_id
                      and (po.status in ('offered','accepted','declined')
                           or (po.status = 'expired'
                               and po.expires_at > now() - interval '2 minutes')))
    -- a courier who released THIS order is not offered it again (per-order exclusion, never a score)
    and not exists (select 1 from public.courier_order_releases rl
                    where rl.courier_id = c.id and rl.order_id = p_order_id)
  -- Live positions first, then recent ones (real distance, up to 10 min old), then none.
  -- Inside a tier: score, then whoever was offered least recently (not the lowest UUID,
  -- which favoured the same courier every time), id only as the last resort.
  order by d.tier, score asc, lo.last_offered_at asc nulls first, c.id
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

CREATE OR REPLACE FUNCTION public.courier_release_order(p_order_id uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_courier uuid;
  v_order public.orders%rowtype;
  v_cap integer;
  v_used integer;
begin
  select id into v_courier from public.couriers where user_id = auth.uid() and is_active;
  if v_courier is null then raise exception 'Doar un curier activ poate renunța la o comandă.'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  -- a replay after a lost response: this courier already released this order -> same answer, no new row
  if found and v_order.courier_id is distinct from v_courier
     and exists (select 1 from public.courier_order_releases r where r.order_id = p_order_id and r.courier_id = v_courier) then
    select daily_cap into v_cap from public.current_courier_release_policy();
    select count(*) into v_used from public.courier_order_releases r
     where r.courier_id = v_courier
       and r.created_at >= (date_trunc('day', now() at time zone 'Europe/Chisinau') at time zone 'Europe/Chisinau');
    return greatest(coalesce(v_cap, 0) - v_used, 0);
  end if;
  if not found or v_order.courier_id is distinct from v_courier then
    raise exception 'Comanda nu îți este atribuită.';
  end if;
  if v_order.status in ('picked_up', 'en_route') then
    raise exception 'Comanda e deja ridicată: renunțarea se face doar prin suport.';
  end if;
  if v_order.status <> 'courier_assigned' then
    raise exception 'Comanda nu mai este activă.';
  end if;
  if p_reason is null or p_reason not in ('vehicle_problem', 'personal_emergency', 'restaurant_delay', 'other') then
    raise exception 'Alege motivul renunțării.';
  end if;

  select daily_cap into v_cap from public.current_courier_release_policy();
  perform 1 from public.couriers where id = v_courier for update;   -- serialises two releases by one courier
  select count(*) into v_used from public.courier_order_releases r
   where r.courier_id = v_courier
     and r.created_at >= (date_trunc('day', now() at time zone 'Europe/Chisinau') at time zone 'Europe/Chisinau');
  if v_used >= coalesce(v_cap, 0) then
    raise exception 'Ai atins limita de % renunțări pe azi. Sună la suport.', coalesce(v_cap, 0);
  end if;

  insert into public.courier_order_releases (order_id, courier_id, reason) values (p_order_id, v_courier, p_reason);
  update public.orders
     set status = 'ready_for_pickup', courier_id = null, courier_arrived_restaurant_at = null
   where id = p_order_id;
  update public.couriers set status = 'online' where id = v_courier and status = 'on_delivery';
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'ready_for_pickup', 'courier', auth.uid());

  begin
    perform public.dispatch_order(p_order_id);
  exception when others then
    insert into public.dispatch_errors (order_id, phase, error_code, message)
    values (p_order_id, 'release', sqlstate, sqlerrm)
    on conflict (order_id, error_code) do update
      set count = public.dispatch_errors.count + 1, last_at = now(),
          message = excluded.message, phase = excluded.phase;
  end;

  return coalesce(v_cap, 0) - v_used - 1;
end;
$function$;
