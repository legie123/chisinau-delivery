-- The courier assigned to an order must be able to read that order's
-- delivery address — without this, both the web courier page and the mobile
-- driver app show no destination for standard orders (addresses RLS only
-- allowed the owning customer and platform_admin).

create policy "addresses_courier_assigned_read" on public.addresses
  for select using (
    exists (
      select 1 from public.orders o
      where o.delivery_address_id = addresses.id
        and o.courier_id in (select id from public.couriers where user_id = auth.uid())
    )
  );
