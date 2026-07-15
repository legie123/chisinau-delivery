-- The assigned courier must read catering_details (event venue/contact) —
-- both the web courier page and the driver app query it for the delivery
-- destination on catering orders; RLS previously allowed only customer,
-- partner and admin, so couriers silently got zero rows.

create policy "catering_details_courier_read" on public.catering_details
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = catering_details.order_id
        and o.courier_id = public.current_courier_id()
    )
  );
