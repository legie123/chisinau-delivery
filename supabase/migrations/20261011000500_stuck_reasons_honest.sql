-- The ready_for_pickup stuck reasons tell the truth (red-team verif-w1 on 20261011000200).
-- Recreated from the LIVE definition with one delta on that bucket:
--   D3 a dispatch error counts only if it is from the last 10 minutes and no live offer exists
--      (an old deadlock no longer lists an order whose next wave already went out);
--   D4 a scheduled order whose dispatch window has not opened (requested_for more than 45 min
--      away, dispatch_order waits by design) is not listed at 3 min; past 15 min it is, with
--      the reason "Programată — dispecerizarea începe cu 45 min înainte";
--   D5 an offer that expired in the last 30 s counts as "between waves", not "no offer".
-- security_invoker restated; column list unchanged.

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
                    WHEN b.status = 'ready_for_pickup'::text AND de.message IS NOT NULL AND NOT st.live_offer THEN (('Dispecerizarea eșuează ('::text || de.count) || '×): '::text) || de.message
                    WHEN b.status = 'ready_for_pickup'::text AND st.requested_for > (now() + '00:45:00'::interval) THEN 'Programată — dispecerizarea începe cu 45 min înainte'::text
                    WHEN b.status = 'ready_for_pickup'::text AND NOT st.recent_offer THEN 'Fără ofertă activă — niciun curier eligibil'::text
                    WHEN b.status = 'ready_for_pickup'::text THEN 'Niciun curier nu a preluat comanda'::text
                    WHEN b.status = 'courier_assigned'::text THEN 'Curierul nu a ridicat comanda'::text
                    ELSE 'Livrare care durează prea mult'::text
                END AS stuck_reason
           FROM admin_order_board b
             LEFT JOIN LATERAL ( SELECT e.message,
                    e.count
                   FROM dispatch_errors e
                  WHERE e.order_id = b.id AND e.last_at > (now() - '00:10:00'::interval)
                  ORDER BY e.last_at DESC
                 LIMIT 1) de ON true
             CROSS JOIN LATERAL ( SELECT (EXISTS ( SELECT 1
                           FROM dispatch_offers d
                          WHERE d.order_id = b.id AND d.status = 'offered'::text AND d.expires_at > now())) AS live_offer,
                    (EXISTS ( SELECT 1
                           FROM dispatch_offers d
                          WHERE d.order_id = b.id AND d.expires_at > (now() - '00:00:30'::interval))) AS recent_offer,
                    ( SELECT o.requested_for
                           FROM orders o
                          WHERE o.id = b.id) AS requested_for) st
          WHERE b.order_type = 'standard'::text AND b.status = 'pending_restaurant'::text AND b.in_state_seconds > (b.accept_sla_minutes * 60 + 120) OR b.order_type = 'standard'::text AND b.status = 'accepted'::text AND b.in_state_seconds > ((b.avg_prep_minutes + 15) * 60) OR b.status = 'ready_for_pickup'::text AND (b.in_state_seconds > (15 * 60) OR de.message IS NOT NULL AND NOT st.live_offer OR b.in_state_seconds > (3 * 60) AND NOT st.recent_offer AND (st.requested_for IS NULL OR st.requested_for <= (now() + '00:45:00'::interval))) OR b.status = 'courier_assigned'::text AND b.in_state_seconds > (15 * 60) OR (b.status = ANY (ARRAY['picked_up'::text, 'en_route'::text])) AND b.in_state_seconds > (45 * 60)) sub
  WHERE has_role('platform_admin'::text);
