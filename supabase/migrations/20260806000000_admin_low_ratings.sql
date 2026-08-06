-- ============================================================================
-- MARELE AUDIT 2026-08-03 — AdminOpsSectorAudit #1 (P0)
--
-- `ratings` (stars + free-text comment) has `ratings_admin_all_read` so a
-- platform_admin CAN read every rating incl. comments — but ZERO admin page
-- ever queried the table. A customer leaving 3 stars + "comanda a ajuns mai
-- rece decat ma asteptam" was invisible in the UI; the founder would have to
-- write SQL to see complaints. That is exactly the "client reclama" crisis
-- scenario that failed the "operate the pilot without psql" test.
--
-- Triage-ready read surface: low/attention ratings (stars <= 3 — for a premium
-- fine-dining brand a 3-star with a comment is an actionable complaint, not
-- noise) joined to the order number + restaurant/courier name so the founder
-- can jump straight to /platform/orders/[id]. Mirrors the other 8 admin_*
-- views: security_invoker (the admin's own RLS reads the base tables) PLUS an
-- explicit has_role('platform_admin') gate baked into the definition, so a
-- non-admin gets zero rows even if a base-table policy were ever broadened.
-- ============================================================================
create or replace view public.admin_low_ratings
with (security_invoker = on) as
select id, order_id, order_number, target_type, stars, comment,
       restaurant_name, courier_name, created_at
from (
  select ra.id,
         ra.order_id,
         o.order_number,
         ra.target_type,
         ra.stars,
         ra.comment,
         r.name AS restaurant_name,
         c.full_name AS courier_name,
         ra.created_at
  from public.ratings ra
  join public.orders o on o.id = ra.order_id
  left join public.restaurants r on r.id = ra.restaurant_id
  left join public.couriers c on c.id = ra.courier_id
  where ra.stars <= 3
) sub
where has_role('platform_admin');

grant select on public.admin_low_ratings to authenticated;
