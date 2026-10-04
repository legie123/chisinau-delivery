-- The restaurant's pickup map showed the courier's LAST point from the previous delivery (the
-- previous customer's door) as the live position, with an ETA, until the first fix of the new leg,
-- and for the whole leg if GPS never started. The customer side had a 120 s freshness check only
-- in the client (useCourierLocation). The bound now lives in RLS, for every reader: server render,
-- realtime refetch, raw API (driver/GPS verifier, 2026-10-04). Same 2 minutes as the client check;
-- the app and the web upsert every 45 s. Roles (authenticated, viewer) are kept by ALTER POLICY.
alter policy courier_locations_partner_read on public.courier_locations
  using (public.restaurant_has_active_order_with_courier(courier_id) and updated_at > now() - interval '2 minutes');

alter policy courier_locations_customer_read on public.courier_locations
  using (public.customer_has_active_order_with_courier(courier_id) and updated_at > now() - interval '2 minutes');
