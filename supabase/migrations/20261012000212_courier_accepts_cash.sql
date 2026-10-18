-- Delivery preference: cash orders (ȚINTA row 93; Bolt lets a courier refuse cash orders).
-- - couriers.accepts_cash boolean not null default true: every existing courier keeps today's behaviour.
-- - set_courier_accepts_cash(boolean) security definer: changes ONLY the caller's own row, found through
--   current_courier_id() (couriers.user_id = auth.uid(), never profiles); there is no target parameter, so
--   one courier cannot change another's preference. Refused while the courier is on_delivery (the cash
--   already in hand is settled first). Execute: authenticated only (not public/anon, not viewer).
-- - dispatch_order (from its LIVE body = 20261012000210, one delta): an order with payment_method = 'cash'
--   is not offered to a courier with accepts_cash = false. card_on_delivery / online_gateway are unaffected.
--   It is an eligibility filter chosen by the courier, never a score (EU 2024/2831).
--   NOTE: 20261012000211_offer_radius_by_vehicle (blocked, not applied) was written on the 210 body. Applied in
--   file order on a fresh db, 212 would erase its radius delta: when unblocked it must be renumbered AFTER 212
--   and rebuilt on THIS body (docs/handoff/CROSS-REQUESTS.md).
-- ROLLBACK: create or replace dispatch_order from 20261012000210; drop function set_courier_accepts_cash(boolean);
--   alter table couriers drop column accepts_cash.

-- parallel sessions apply migrations on the same local db: fail fast instead of queueing behind their locks
set local lock_timeout = '5s';

alter table public.couriers add column accepts_cash boolean not null default true;
comment on column public.couriers.accepts_cash is
  'Preferința curierului: false = nu i se oferă comenzi cu plata cash (dispatch_order). Se schimbă doar prin set_courier_accepts_cash.';

create or replace function public.set_courier_accepts_cash(p_accepts boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_courier uuid := public.current_courier_id();
  v_status text;
begin
  if v_courier is null then
    raise exception 'Doar un curier poate schimba preferința pentru comenzile cu numerar.';
  end if;
  if p_accepts is null then
    raise exception 'Alege dacă accepți sau nu comenzi cu numerar.';
  end if;
  select status into v_status from public.couriers where id = v_courier for update;
  if v_status = 'on_delivery' then
    raise exception 'Nu poți schimba preferința pentru numerar în timpul unei livrări. Termină livrarea întâi.';
  end if;
  update public.couriers set accepts_cash = p_accepts where id = v_courier;
  return p_accepts;
end;
$$;
revoke all on function public.set_courier_accepts_cash(boolean) from public, anon;
grant execute on function public.set_courier_accepts_cash(boolean) to authenticated;

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
    -- a courier who turned cash orders off is not offered a cash one (20261012000212); card_on_delivery and
    -- online_gateway orders still are. The courier's own choice, an eligibility filter, never a score.
    and (v_order.payment_method <> 'cash' or c.accepts_cash)
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
