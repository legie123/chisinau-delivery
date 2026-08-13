-- Dezbatere 2026-08-12 GAP confirmat (P1): a restaurant that accepted an order
-- and then discovered it cannot fulfil it (out of stock, equipment failure)
-- had NO self-service exit — reject_order is pending-only, cancel_order has no
-- partner branch, and toggling item availability does nothing to a placed
-- order. The only remedy was phoning the platform admin. Real-world top-3.
--
-- restaurant_cancel_order(order_id, reason): staff-only, allowed ONLY while
-- the food is still the restaurant's problem (accepted / ready_for_pickup,
-- before any courier pickup). Cancels live dispatch offers, writes the status
-- event with the reason, and notifies the customer through the outbox.

create or replace function public.restaurant_cancel_order(p_order_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
begin
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'motivul anulării este obligatoriu (minim 5 caractere)';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status not in ('accepted', 'ready_for_pickup') then
    raise exception 'comanda nu mai poate fi anulată de restaurant din starea %', v_order.status;
  end if;
  -- once a courier picked it up the food left the building — admin territory
  if exists (
    select 1 from public.delivery_status_events e
    where e.order_id = p_order_id and e.status = 'picked_up'
  ) then
    raise exception 'comanda a fost deja ridicată de curier';
  end if;

  update public.orders
  set status = 'cancelled',
      cancellation_reason = 'Restaurantul nu poate onora comanda: ' || trim(p_reason)
  where id = p_order_id;

  -- kill any live offer so no courier accepts a dead order
  update public.dispatch_offers
  set status = 'cancelled'
  where order_id = p_order_id and status = 'offered';

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'cancelled', 'restaurant_partner', auth.uid(), trim(p_reason));

  insert into public.notification_outbox (user_id, title, body, url, tag)
  values (
    v_order.customer_id,
    'Comanda a fost anulată de restaurant 😔',
    'Motiv: ' || trim(p_reason) || ' Ne pare rău — comanda ' || v_order.order_number || ' nu a fost taxată în numerar; pentru plăți online, restituirea pornește automat.',
    '/orders/' || p_order_id,
    'order-' || p_order_id
  );
end;
$function$;

revoke execute on function public.restaurant_cancel_order(uuid, text) from public, anon;
grant execute on function public.restaurant_cancel_order(uuid, text) to authenticated;
