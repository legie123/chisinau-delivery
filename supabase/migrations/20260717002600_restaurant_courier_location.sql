-- GPS for restaurants: let a partner see the assigned courier approaching for
-- PICKUP. Scoped to the courier_assigned window only — once the courier picks up
-- (status leaves courier_assigned) the restaurant loses location access. Mirrors
-- the customer's courier_locations_customer_read policy.

create or replace function public.restaurant_has_active_order_with_courier(target_courier uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.orders o
    where o.courier_id = target_courier
      and o.status = 'courier_assigned'
      and public.has_restaurant_access(o.restaurant_id)
  );
$$;

drop policy if exists "courier_locations_partner_read" on public.courier_locations;
create policy "courier_locations_partner_read" on public.courier_locations
  for select using (public.restaurant_has_active_order_with_courier(courier_id));
