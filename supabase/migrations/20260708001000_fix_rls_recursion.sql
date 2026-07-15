-- Fix: "infinite recursion detected in policy" (42P17) on authenticated
-- courier queries. Cycle: orders policies subquery couriers, and
-- couriers_customer_scoped_read subqueries orders — evaluating either
-- table's policies re-triggers the other's. Security-definer helpers break
-- the cycle because their internal queries bypass RLS entirely.

create or replace function public.current_courier_id()
returns uuid
language sql
security definer
set search_path = public, auth
stable
as $$
  select id from public.couriers where user_id = auth.uid();
$$;

create or replace function public.customer_has_order_with_courier(target_courier uuid)
returns boolean
language sql
security definer
set search_path = public, auth
stable
as $$
  select exists (
    select 1 from public.orders
    where customer_id = auth.uid() and courier_id = target_courier
  );
$$;

create or replace function public.customer_has_active_order_with_courier(target_courier uuid)
returns boolean
language sql
security definer
set search_path = public, auth
stable
as $$
  select exists (
    select 1 from public.orders
    where customer_id = auth.uid()
      and courier_id = target_courier
      and status in ('picked_up', 'en_route')
  );
$$;

create or replace function public.courier_is_assigned_to_address(target_address uuid)
returns boolean
language sql
security definer
set search_path = public, auth
stable
as $$
  select exists (
    select 1 from public.orders
    where delivery_address_id = target_address
      and courier_id = public.current_courier_id()
  );
$$;

-- orders: courier-side policies no longer subquery couriers under RLS
drop policy "orders_courier_scope" on public.orders;
create policy "orders_courier_scope" on public.orders
  for select using (courier_id = public.current_courier_id());

-- order_items: same fix inside the orders join
drop policy "order_items_scoped_read" on public.order_items;
create policy "order_items_scoped_read" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          o.customer_id = auth.uid()
          or has_restaurant_access(o.restaurant_id)
          or o.courier_id = public.current_courier_id()
          or has_role('platform_admin')
        )
    )
  );

-- delivery_status_events: same fix
drop policy "delivery_status_events_scoped_read" on public.delivery_status_events;
create policy "delivery_status_events_scoped_read" on public.delivery_status_events
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = delivery_status_events.order_id
        and (
          o.customer_id = auth.uid()
          or has_restaurant_access(o.restaurant_id)
          or o.courier_id = public.current_courier_id()
          or has_role('platform_admin')
        )
    )
  );

-- couriers: customer-side read no longer subqueries orders under RLS
drop policy "couriers_customer_scoped_read" on public.couriers;
create policy "couriers_customer_scoped_read" on public.couriers
  for select using (public.customer_has_order_with_courier(id));

-- courier_locations: both directions
drop policy "courier_locations_self_all" on public.courier_locations;
create policy "courier_locations_self_all" on public.courier_locations
  for all
  using (courier_id = public.current_courier_id())
  with check (courier_id = public.current_courier_id());

drop policy "courier_locations_customer_read" on public.courier_locations;
create policy "courier_locations_customer_read" on public.courier_locations
  for select using (public.customer_has_active_order_with_courier(courier_id));

-- addresses: courier read via helper
drop policy "addresses_courier_assigned_read" on public.addresses;
create policy "addresses_courier_assigned_read" on public.addresses
  for select using (public.courier_is_assigned_to_address(id));

-- Helpers are called from RLS policies evaluated for any querying role.
grant execute on function public.current_courier_id() to anon, authenticated;
grant execute on function public.customer_has_order_with_courier(uuid) to anon, authenticated;
grant execute on function public.customer_has_active_order_with_courier(uuid) to anon, authenticated;
grant execute on function public.courier_is_assigned_to_address(uuid) to anon, authenticated;
