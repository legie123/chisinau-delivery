-- Wave B2 — kill the self-confirm payment exploit.
--
-- The prior confirm_online_payment authorized `v_order.customer_id = auth.uid()`,
-- so the ordering customer could call it with p_success=true and mark their OWN
-- online order 'paid' — free food while the platform still owes the restaurant
-- commission. Online payment is a mock (no real PSP), so no honest actor other
-- than a real gateway webhook (service role) or an admin reconciling by hand
-- should ever settle an intent.
--
-- Fix: require the caller be the service role (a real PSP webhook runs with the
-- service key → auth.uid() is null, jwt role = 'service_role') OR a platform
-- admin. The ordering customer can NEVER confirm their own payment. The settle
-- body is preserved verbatim for the day a real gateway is wired.

create or replace function public.confirm_online_payment(p_intent_id uuid, p_success boolean, p_provider_ref text default null)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_intent public.payment_intents%rowtype;
  v_order public.orders%rowtype;
  v_caller_role text := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
begin
  -- authz: ONLY a real gateway webhook (service role) or a platform admin may
  -- settle an intent. The ordering customer must never confirm their own payment.
  if v_caller_role <> 'service_role' and not has_role('platform_admin') then
    raise exception 'not authorized — confirmarea plății online se face doar de gateway/administrator';
  end if;

  select * into v_intent from public.payment_intents where id = p_intent_id for update;
  if not found then raise exception 'intent not found'; end if;
  select * into v_order from public.orders where id = v_intent.order_id for update;
  if v_intent.status <> 'pending' then return; end if; -- idempotent

  if p_success then
    update public.payment_intents set status = 'succeeded', provider_ref = p_provider_ref, updated_at = now() where id = p_intent_id;
    update public.orders set payment_status = 'paid' where id = v_intent.order_id;
    insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
    values (v_intent.order_id, v_order.status, coalesce((select role from public.profiles where id = auth.uid()), 'system'), auth.uid(), 'online payment succeeded');
  else
    update public.payment_intents set status = 'failed', updated_at = now() where id = p_intent_id;
    update public.orders set payment_status = 'unpaid' where id = v_intent.order_id and payment_status = 'pending_capture';
  end if;
end; $$;

grant execute on function public.confirm_online_payment(uuid, boolean, text) to authenticated;
