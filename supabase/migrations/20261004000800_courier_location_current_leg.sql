-- 20261004000700 bounded what the restaurant and the customer see of the courier's position by AGE
-- (2 minutes). The real defect was a point from BEFORE the current leg: the previous customer's
-- door shown on the next restaurant's pickup map. The age bound also hid a courier standing still
-- at the restaurant (the iOS app records a point only after 25 m of movement) and a courier
-- stopped in traffic (verifier round 4, 2026-10-04). Visibility now follows the leg: the
-- restaurant sees points recorded since the order's latest courier_assigned event, the customer
-- points since its latest picked_up event. Same callers and roles as the helpers they extend
-- (restaurant_has_active_order_with_courier / customer_has_active_order_with_courier).
create or replace function public.restaurant_sees_courier_point(target_courier uuid, point_at timestamptz)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'auth'
as $function$
  select exists (
    select 1 from public.orders o
    where o.courier_id = target_courier
      and o.status = 'courier_assigned'
      and public.has_restaurant_access(o.restaurant_id)
      and point_at >= coalesce(
        (select max(e.created_at) from public.delivery_status_events e
         where e.order_id = o.id and e.status = 'courier_assigned'),
        o.created_at)
  );
$function$;

create or replace function public.customer_sees_courier_point(target_courier uuid, point_at timestamptz)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'auth'
as $function$
  select exists (
    select 1 from public.orders o
    where o.customer_id = auth.uid()
      and o.courier_id = target_courier
      and o.status in ('picked_up', 'en_route')
      and point_at >= coalesce(
        (select max(e.created_at) from public.delivery_status_events e
         where e.order_id = o.id and e.status = 'picked_up'),
        o.created_at)
  );
$function$;

-- No PUBLIC EXECUTE (sim 73.a4); the API roles and the read-only viewer, like the helpers above.
revoke execute on function public.restaurant_sees_courier_point(uuid, timestamptz) from public;
revoke execute on function public.customer_sees_courier_point(uuid, timestamptz) from public;
grant execute on function public.restaurant_sees_courier_point(uuid, timestamptz) to anon, authenticated, service_role, viewer;
grant execute on function public.customer_sees_courier_point(uuid, timestamptz) to anon, authenticated, service_role, viewer;

alter policy courier_locations_partner_read on public.courier_locations
  using (public.restaurant_sees_courier_point(courier_id, updated_at));

alter policy courier_locations_customer_read on public.courier_locations
  using (public.customer_sees_courier_point(courier_id, updated_at));
