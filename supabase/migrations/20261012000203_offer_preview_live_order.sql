-- Red-team fixes on 20261012000201 / 20261012000202 (verif-curier, 2026-10-11).
--
-- 1. offer_preview answered for an offer that is still 'offered' on an order that is no longer up
--    for grabs: expire_stale_orders() cancels a zombie ready order but leaves its offer 'offered',
--    so the holder kept seeing the sector and km of a cancelled order. A live offer only exists on a
--    ready_for_pickup order (accept_dispatch_offer claims it with status = 'ready_for_pickup'), so
--    the preview now requires exactly that. Recreated from the LIVE body (re-read before applying),
--    one delta: `and o.status = 'ready_for_pickup'`. Signature unchanged -> grants kept.
-- 2. The column comment on orders.courier_fee_distance_assumed over-promised ("exactly when"). The flag
--    describes the fee as computed AT DELIVERY. The quote stamped at ready is a floor and can decide the
--    amount; if a pin changed in between (an admin editing the restaurant pin; the address pin is
--    locked in flight) the flag can be false although the paid quote was built on 6.0 km, or true
--    although the quote was measured. Comment only; no behaviour change.
CREATE OR REPLACE FUNCTION public.offer_preview(p_offer_id uuid)
 RETURNS TABLE(dropoff_sector text, pickup_km numeric, trip_km numeric, total_km numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    and d.expires_at > now()
    and o.status = 'ready_for_pickup';
$function$;

comment on column public.orders.courier_fee_distance_assumed is
  'True when, at delivery, courier_fee_mdl was computed with the 6.0 km fallback because a pin was missing. The quote stamped at ready_for_pickup is a floor and can decide the paid amount, so if a pin changed after ready the flag can disagree with the quote (admin edit of the restaurant pin). Review flagged orders AND delivered orders with a missing pin.';

-- ROLLBACK (after 20261012000204's): re-run lines 19-44 of 20261012000201_offer_preview.sql (offer_preview
-- without the order-status check) and the column comment at lines 25-26 of 20261012000202_courier_fee_distance_assumed.sql.
