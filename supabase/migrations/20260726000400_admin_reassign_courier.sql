-- Wave D1 — admin honest rescue for a ghosting courier.
--
-- assign_courier is self-claim only (a courier claims a ready order for THEMSELVES).
-- When an assigned courier goes dark — accepted the run, never moves — an admin had
-- no lever but fake-completion or cancellation. This RPC lets a platform_admin
-- hand a stuck in-flight order to another available courier: the new courier starts
-- fresh from the restaurant (status resets to courier_assigned), the old courier is
-- released, dangling offers are cancelled, and the move is logged in the timeline.

create or replace function public.admin_reassign_courier(p_order_id uuid, p_new_courier_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
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

  -- The new courier is freshly assigned and heads to the restaurant.
  update public.orders
    set status = 'courier_assigned', courier_id = p_new_courier_id
    where id = p_order_id;

  -- Release the old courier ONLY if they were on this delivery (a ghost who went
  -- offline stays offline). Capacity = 1 active order, so they're now fully free.
  if v_old_courier is not null then
    update public.couriers set status = 'online' where id = v_old_courier and status = 'on_delivery';
  end if;
  update public.couriers set status = 'on_delivery' where id = p_new_courier_id;

  -- Kill any dangling live offer for this order.
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where order_id = p_order_id and status = 'offered';

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'courier_assigned', 'platform_admin', auth.uid(),
          format('reatribuit curier: %s → %s', coalesce(v_old_courier::text, '—'), p_new_courier_id::text));
end;
$$;

revoke execute on function public.admin_reassign_courier(uuid, uuid) from public, anon;
grant execute on function public.admin_reassign_courier(uuid, uuid) to authenticated;
