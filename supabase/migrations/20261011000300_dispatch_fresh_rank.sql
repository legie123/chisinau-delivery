-- Dispatch ranks real, fresh positions first.
-- dispatch_order trusted a courier position for 10 minutes and gave a courier with no position an
-- assumed 6.0 km, which it then stored in dispatch_offers.distance_km and both courier apps showed
-- as "~6.0 km până la restaurant". A courier with no GPS beat one really 8 km away; a 5-minute-old
-- position beat a live one. Recreated from its LIVE body (20260813000400) with one delta:
--   * a position counts for 2 minutes (as in nearby_available_couriers);
--   * couriers with a live position rank before those without, then by score, then by id;
--   * an unknown distance is scored as 6.0 km among the stale ones but stored as null.
-- Couriers without a fresh position stay eligible: a small pilot fleet must not starve when an
-- idle phone stops sending. The 30 s offer window stays as is (business number, not ratified).

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
    on cl.courier_id = c.id and cl.updated_at > now() - interval '2 minutes' and cl.is_plausible
  cross join lateral (
    select case c.vehicle_type
      when 'bike' then 12 when 'e_bike' then 18 when 'scooter' then 25
      when 'car' then 22 else 5 end::numeric as speed_kmh
  ) v
  cross join lateral (
    select public.haversine_km(cl.lat, cl.lng, r.lat, r.lng) as dist_km
  ) d
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
  -- A live position (2 min, same window as nearby_available_couriers) always ranks before a
  -- stale or missing one; ties break on id so the same state gives the same courier.
  order by (cl.courier_id is null), score asc, c.id
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
