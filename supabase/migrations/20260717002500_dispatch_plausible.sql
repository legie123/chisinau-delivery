-- Consistency fix (data-integrity backtest): dispatch_order scored couriers using
-- courier_locations WITHOUT the is_plausible filter, while courier_dispatch_distance_m
-- and nearby_available_couriers require it — so a teleport-flagged courier could still
-- be dispatched on their implausible GPS. Add `and cl.is_plausible`: an implausible
-- (or stale/missing) fix now falls back to the neutral 6 km default in the coalesce.
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

  select c.id as courier_id, d.dist_km,
         round(d.dist_km / v.speed_kmh * 60 + (1 - acc.rate) * 10, 2) as score
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
  left join lateral (
    select case when count(*) = 0 then 1.0
      else avg((o2.status = 'accepted')::int)::numeric end as rate
    from public.dispatch_offers o2
    where o2.courier_id = c.id
      and o2.status in ('accepted', 'declined', 'expired')
      and o2.created_at > now() - interval '14 days'
  ) acc on true
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
