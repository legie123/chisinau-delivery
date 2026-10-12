-- offer_preview(offer_id): what a courier may know about a LIVE offer before accepting it.
--
-- The driver app's OfferCard shows restaurant, net earnings and "~X km până la restaurant"
-- (dispatch_offers.distance_km). It cannot show where the food goes or how long the whole trip is,
-- because the customer's address is only readable once the courier is assigned
-- (addresses_courier_assigned_read). A courier deciding in 30 s needs the SECTOR and the total
-- distance, not the street (Bolt/Glovo show the same: area + km, address after accept).
--
-- New function (nothing recreated, so no live body to copy). Authorization is the point
-- (hard rule 3): only the courier holding the offer, while it is live (status 'offered' and not
-- past expires_at) and the courier is active, gets a row. Everyone else (another courier, the
-- customer, anon, an expired / declined / accepted offer) gets ZERO rows — same answer as for an
-- offer that does not exist, so the id cannot be probed. Coordinates and street never leave.
--
-- pickup_km  = dispatch_offers.distance_km (courier -> restaurant, straight line, null when the
--              courier had no fresh position at offer time — never an invented number)
-- trip_km    = restaurant -> drop-off, straight line; null when the order has no drop-off pin
-- total_km   = pickup_km + trip_km; null unless BOTH are known (no partial sums)
create or replace function public.offer_preview(p_offer_id uuid)
returns table (dropoff_sector text, pickup_km numeric, trip_km numeric, total_km numeric)
language sql
stable
security definer
set search_path = 'public', 'auth'
as $$
  select a.sector,
         d.distance_km,
         t.trip_km,
         case when d.distance_km is not null and t.trip_km is not null
              then round(d.distance_km + t.trip_km, 2) end
  from public.dispatch_offers d
  join public.couriers c on c.id = d.courier_id and c.is_active
  join public.orders o on o.id = d.order_id
  join public.restaurants r on r.id = o.restaurant_id
  left join public.addresses a on a.id = o.delivery_address_id
  cross join lateral (
    select case when r.lat is not null and r.lng is not null and a.lat is not null and a.lng is not null
                then round(public.haversine_km(r.lat, r.lng, a.lat, a.lng), 2) end as trip_km
  ) t
  where d.id = p_offer_id
    and d.courier_id = public.current_courier_id()
    and d.status = 'offered'
    and d.expires_at > now();
$$;

-- A new function is executable by PUBLIC (and so by anon) until revoked.
revoke all on function public.offer_preview(uuid) from public, anon;
grant execute on function public.offer_preview(uuid) to authenticated;

-- ROLLBACK (after 20261012000203's): drop function public.offer_preview(uuid);
