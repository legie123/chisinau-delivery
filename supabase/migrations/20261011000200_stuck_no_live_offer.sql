-- Ops sees an undispatchable order in minutes, not after 15.
-- admin_stuck_orders listed a ready_for_pickup order only after 15 minutes, whatever the cause.
-- Recreated from its LIVE definition with one delta on the ready_for_pickup bucket:
--   * a recorded dispatch failure (dispatch_errors, 20261011000100) lists it at once, with the
--     error text and repeat count as the reason;
--   * 3+ minutes with no live offer lists it as "Fără ofertă activă";
--   * the old 15-minute rule stays for orders that keep getting offers nobody accepts.
-- security_invoker is restated (CREATE OR REPLACE VIEW would drop it); column list unchanged,
-- so grants, generated types and every reader stay as they are.

create or replace view public.admin_stuck_orders with (security_invoker = on) as
SELECT id,
    order_number,
    order_type,
    status,
    payment_method,
    payment_status,
    total_mdl,
    created_at,
    notes,
    restaurant_id,
    restaurant_name,
    accept_sla_minutes,
    avg_prep_minutes,
    courier_id,
    courier_name,
    courier_status,
    street_address,
    sector,
    delivery_lat,
    delivery_lng,
    in_state_since,
    in_state_seconds,
    stuck_reason
   FROM ( SELECT b.id,
            b.order_number,
            b.order_type,
            b.status,
            b.payment_method,
            b.payment_status,
            b.total_mdl,
            b.created_at,
            b.notes,
            b.restaurant_id,
            b.restaurant_name,
            b.accept_sla_minutes,
            b.avg_prep_minutes,
            b.courier_id,
            b.courier_name,
            b.courier_status,
            b.street_address,
            b.sector,
            b.delivery_lat,
            b.delivery_lng,
            b.in_state_since,
            b.in_state_seconds,
                CASE
                    WHEN b.status = 'pending_restaurant'::text THEN 'SLA depășit — sweeper-ul pg_cron nu a rulat'::text
                    WHEN b.status = 'accepted'::text THEN 'Pregătire peste timpul estimat'::text
                    WHEN b.status = 'ready_for_pickup'::text AND de.message IS NOT NULL THEN ((('Dispecerizarea eșuează ('::text || de.count) || '×): '::text) || de.message)
                    WHEN b.status = 'ready_for_pickup'::text AND NOT (EXISTS ( SELECT 1
                       FROM dispatch_offers d
                      WHERE d.order_id = b.id AND d.status = 'offered'::text AND d.expires_at > now())) THEN 'Fără ofertă activă — niciun curier eligibil'::text
                    WHEN b.status = 'ready_for_pickup'::text THEN 'Niciun curier nu a preluat comanda'::text
                    WHEN b.status = 'courier_assigned'::text THEN 'Curierul nu a ridicat comanda'::text
                    ELSE 'Livrare care durează prea mult'::text
                END AS stuck_reason
           FROM admin_order_board b
             LEFT JOIN LATERAL ( SELECT e.message, e.count
                   FROM dispatch_errors e
                  WHERE e.order_id = b.id
                  ORDER BY e.last_at DESC
                 LIMIT 1) de ON true
          WHERE b.order_type = 'standard'::text AND b.status = 'pending_restaurant'::text AND b.in_state_seconds > (b.accept_sla_minutes * 60 + 120) OR b.order_type = 'standard'::text AND b.status = 'accepted'::text AND b.in_state_seconds > ((b.avg_prep_minutes + 15) * 60) OR b.status = 'ready_for_pickup'::text AND (b.in_state_seconds > (15 * 60) OR de.message IS NOT NULL OR b.in_state_seconds > (3 * 60) AND NOT (EXISTS ( SELECT 1
                   FROM dispatch_offers d
                  WHERE d.order_id = b.id AND d.status = 'offered'::text AND d.expires_at > now()))) OR b.status = 'courier_assigned'::text AND b.in_state_seconds > (15 * 60) OR (b.status = ANY (ARRAY['picked_up'::text, 'en_route'::text])) AND b.in_state_seconds > (45 * 60)) sub
  WHERE has_role('platform_admin'::text);
