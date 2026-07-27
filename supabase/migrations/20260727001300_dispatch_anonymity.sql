-- Order 6 — dispatch anonymity: courier-facing dispatch must never let a
-- courier's past REJECT behaviour leak into who gets offered an order or at
-- what score. dispatch_order()'s formula has, since WS2, included a
-- (1 - 14d_acceptance_rate) * alpha1 term — meaning a courier who declined
-- offers (their right, no penalty per policy) scored worse and could be
-- passed over. alpha1 is admin-tunable (dispatch_scoring_config,
-- 20260727000600) which made this a LIVE, not just historical, risk: any
-- admin retune with alpha1 > 0 reintroduces the penalty.
--
-- Fix is STRUCTURAL, not a zero-weighting: the (1 - acc.rate) * alpha1 term
-- and its supporting `acc` lateral-join subquery (which aggregated each
-- candidate's accepted/declined/expired history) are deleted OUTRIGHT from
-- the SQL. alpha0 stays live-read from dispatch_scoring_config exactly as
-- before (is_plausible GPS filter untouched, wave/capacity/lock guards
-- untouched). alpha1/alpha2 remain admin-tunable columns on
-- dispatch_scoring_config (retuning is not blocked at the config layer —
-- that's Faza 4 NSGA-II's business, not this migration's) but the score no
-- longer has any path that reads alpha1, so "no reject penalty" is true by
-- construction, not by admins behaving.
create or replace function public.dispatch_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
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

  select coalesce(max(wave), 0) + 1 into v_wave from public.dispatch_offers where order_id = p_order_id;
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
