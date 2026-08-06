-- ============================================================================
-- MARELE AUDIT 2026-08-03 — DispatchCourierAudit #1 (P1)
--
-- admin_assign_courier / admin_reassign_courier cancel the live dispatch_offers
-- for the ORDER being assigned, but NOT the target courier's own live offer for
-- some OTHER order. Scenario: courier X is online with an auto-dispatched 30s
-- offer for order A (status 'offered'); before X answers, an admin manually
-- assigns X to order B. X becomes on_delivery on B, but the offer for A is left
-- 'offered'. 30s later the sweeper EXPIRES it and bumps X's
-- consecutive_ignored_offers; at streak 3 the sweeper force-offlines X and
-- closes their shift — WHILE X is out delivering B. Result: lost shift/hours
-- data (payroll + go/no-go KPI), a false "trecut offline automat" push to an
-- active courier, and a third fleet-state drift path.
--
-- Fix: in both RPCs, also cancel the target courier's live offer(s) for ANY
-- order (structural mirror of what accept_dispatch_offer guarantees via the
-- live_per_courier unique partial index). A 'cancelled' offer never touches the
-- ignore streak (only EXPIRED does), so no false ghost. Order A, left with no
-- live offer, is re-dispatched by the sweeper on its next tick — nothing
-- stranded. One-line change per function; the rest of each body is unchanged.
-- ============================================================================
create or replace function public.admin_assign_courier(p_order_id uuid, p_new_courier_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_order public.orders%rowtype;
  v_new public.couriers%rowtype;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    raise exception 'comanda nu e liberă de atribuit (stare %, curier %)',
      v_order.status, coalesce(v_order.courier_id::text, '—');
  end if;

  select * into v_new from public.couriers where id = p_new_courier_id for update;
  if not found or not v_new.is_active then raise exception 'curierul nu este disponibil'; end if;
  if not public.courier_has_capacity(p_new_courier_id) then
    raise exception 'curierul are deja o livrare activă';
  end if;

  update public.orders
    set status = 'courier_assigned', courier_id = p_new_courier_id, courier_arrived_restaurant_at = null
    where id = p_order_id;
  update public.couriers set status = 'on_delivery' where id = p_new_courier_id;

  -- Cancel the live offer for THIS order AND any live offer the target courier
  -- still holds for another order (else it expires and ghost-offlines them).
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where status = 'offered' and (order_id = p_order_id or courier_id = p_new_courier_id);

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'courier_assigned', 'platform_admin', auth.uid(),
          format('atribuit manual curier: %s', p_new_courier_id::text));
end;
$function$;

create or replace function public.admin_reassign_courier(p_order_id uuid, p_new_courier_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_order public.orders%rowtype;
  v_old_courier uuid;
  v_new public.couriers%rowtype;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status not in ('courier_assigned', 'picked_up', 'en_route') then
    raise exception 'comanda nu are un curier de reatribuit (stare %)', v_order.status;
  end if;
  v_old_courier := v_order.courier_id;

  select * into v_new from public.couriers where id = p_new_courier_id for update;
  if not found or not v_new.is_active then raise exception 'curierul nou nu este disponibil'; end if;
  if p_new_courier_id = v_old_courier then raise exception 'curierul nou este același cu cel curent'; end if;
  if not public.courier_has_capacity(p_new_courier_id) then
    raise exception 'curierul nou are deja o livrare activă';
  end if;

  -- The new courier is freshly assigned and heads to the restaurant. Reset the
  -- arrival clock: whatever the old courier stamped (or didn't) does not
  -- describe the new courier's trip.
  update public.orders
    set status = 'courier_assigned', courier_id = p_new_courier_id, courier_arrived_restaurant_at = null
    where id = p_order_id;

  -- Release the old courier ONLY if they were on this delivery (a ghost who went
  -- offline stays offline). Capacity = 1 active order, so they're now fully free.
  if v_old_courier is not null then
    update public.couriers set status = 'online' where id = v_old_courier and status = 'on_delivery';
  end if;
  update public.couriers set status = 'on_delivery' where id = p_new_courier_id;

  -- Kill the dangling live offer for this order AND any live offer the new
  -- courier still holds for another order (else it expires and ghost-offlines them).
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where status = 'offered' and (order_id = p_order_id or courier_id = p_new_courier_id);

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'courier_assigned', 'platform_admin', auth.uid(),
          format('reatribuit curier: %s → %s', coalesce(v_old_courier::text, '—'), p_new_courier_id::text));
end;
$function$;
