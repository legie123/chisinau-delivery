-- Courier contact scope. couriers_customer_scoped_read (customer_has_order_with_courier)
-- let a customer SELECT * on any courier who EVER delivered to them — forever, every
-- column: status (online presence), consecutive_ignored_offers, user_id, rating,
-- referral code. The customer screens only need the first name + phone of the courier
-- on their own in-flight order (web OrderTracking + app OrderTrackingScreen show the
-- card only for courier_assigned / picked_up / en_route; nothing after delivery).
-- Fix: drop the customer table policy; order_courier_contact(order) is the only path.
-- customer_has_active_order_with_courier is NOT reused: it is the courier_locations
-- (GPS) gate and deliberately starts at picked_up; the call button starts at
-- courier_assigned. Courier self-read, admin and viewer policies are untouched.
-- (Restaurant partners never had a couriers policy — restaurant/orders reads null,
-- unchanged here.)

drop policy if exists couriers_customer_scoped_read on public.couriers;

create or replace function public.order_courier_contact(p_order_id uuid)
returns table (first_name text, phone text)
language sql
stable
security definer
set search_path = public
as $$
  select split_part(btrim(c.full_name), ' ', 1), c.phone
  from public.orders o
  join public.couriers c on c.id = o.courier_id
  where o.id = p_order_id
    and o.customer_id = (select auth.uid())
    and o.status in ('courier_assigned', 'picked_up', 'en_route');
$$;

revoke execute on function public.order_courier_contact(uuid) from public, anon;
grant execute on function public.order_courier_contact(uuid) to authenticated, service_role;

comment on function public.order_courier_contact(uuid) is
  'Prenumele + telefonul curierului pentru comanda proprie a apelantului, doar cât e courier_assigned/picked_up/en_route.';
