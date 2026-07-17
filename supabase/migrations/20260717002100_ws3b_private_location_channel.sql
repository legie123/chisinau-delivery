-- Fix backtest defect #3 (HIGH): courier live GPS was broadcast on a PUBLIC
-- Realtime channel `order:{id}:location` — anyone with the order UUID could track.
-- Make that channel PRIVATE (client sets config.private=true) and gate it with
-- Realtime Authorization: RLS policies on realtime.messages. realtime.messages
-- has RLS enabled with NO policies today, so public channels bypass it entirely
-- (the leak) while private channels are deny-all until a policy grants access.
-- Only the location channel becomes private; postgres_changes channels stay public
-- (authorized by table RLS), so this change's blast radius is that one channel.
--
-- Topic shape: 'order:{uuid}:location'. The regex guard runs BEFORE the ::uuid
-- cast so a malformed topic can never raise inside the policy (which would error
-- the subscribe). substring(topic from 7 for 36) = the uuid ('order:' is 6 chars).

-- Receive / join: the order's customer, the assigned courier, or a platform admin.
drop policy if exists "courier_location_receive" on realtime.messages;
create policy "courier_location_receive" on realtime.messages
for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() ~ '^order:[0-9a-fA-F-]{36}:location$'
  and exists (
    select 1 from public.orders o
    where o.id = substring(realtime.topic() from 7 for 36)::uuid
      and (o.customer_id = auth.uid()
           or o.courier_id = public.current_courier_id()
           or public.has_role('platform_admin'))
  )
);

-- Send / broadcast: only the courier actually assigned to the order may emit its
-- position (a customer/admin can watch but never inject a fake location).
drop policy if exists "courier_location_send" on realtime.messages;
create policy "courier_location_send" on realtime.messages
for insert to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() ~ '^order:[0-9a-fA-F-]{36}:location$'
  and exists (
    select 1 from public.orders o
    where o.id = substring(realtime.topic() from 7 for 36)::uuid
      and o.courier_id = public.current_courier_id()
  )
);
