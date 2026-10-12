-- View-as parity for the customer read added in 20261012000109 (sim 73.a5: every SELECT policy must
-- also cover the viewer role, so "vezi ca" shows what the customer sees; viewer_session_live still
-- restricts it to a live session).
-- Rollback: re-create the policy with `to authenticated` only.

drop policy if exists order_complaints_customer_read on public.order_complaints;
create policy order_complaints_customer_read on public.order_complaints
  for select to authenticated, viewer using (
    exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid()))
  );
