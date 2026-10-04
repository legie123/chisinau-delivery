-- assign_courier (the courier's PULL path) enforced only is_active + capacity + distance + status,
-- none of the gates dispatch_order applies (cross-app E2E audit, 2026-10-04): an offline courier with
-- no open shift could claim a waiting order (status flipped offline -> on_delivery, bypassing the
-- reactivation cash threshold in set_courier_online_status), tomorrow's catering order could be
-- claimed today, and the cash-aware float gate did not apply. Live body + three gates after the
-- capacity check, same predicates as dispatch_order (online; requested_for - 45 min; standard cash
-- balance + total >= effective_cash_cap). The idempotent same-courier retry still returns first.
CREATE OR REPLACE FUNCTION public.assign_courier(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_order public.orders%rowtype;
  v_courier_id uuid;
  v_status text;
begin
  select id, status into v_courier_id, v_status from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;
  perform 1 from public.couriers where id = v_courier_id for no key update;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.courier_id = v_courier_id and v_order.status = 'courier_assigned' then return; end if;

  if not public.courier_has_capacity(v_courier_id) then
    raise exception 'you already have an active delivery';
  end if;
  -- The pull path used to skip every gate dispatch_order enforces (verifier, 2026-10-04): an OFFLINE
  -- courier (no open shift) could claim, a catering order scheduled for tomorrow could be claimed
  -- today, and the cash-aware gate was bypassed.
  if v_status <> 'online' then
    raise exception 'treci pe online ca să poți prelua comenzi';
  end if;
  if v_order.requested_for is not null and v_order.requested_for > now() + interval '45 minutes' then
    raise exception 'comandă programată: poate fi preluată cu cel mult 45 de minute înainte';
  end if;
  if v_order.payment_method = 'cash' and v_order.order_type = 'standard'
     and public.courier_cash_balance(v_courier_id) + v_order.total_mdl >= public.effective_cash_cap(v_courier_id) then
    raise exception 'plafonul de numerar al curierului ar fi depășit de această comandă';
  end if;
  if public.courier_dispatch_distance_m(v_courier_id, v_order.restaurant_id) > 15000 then
    raise exception 'too far from restaurant to claim this order';
  end if;
  if v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    raise exception 'order not available for assignment';
  end if;
  -- #16: while the scored dispatch has a LIVE offer out to someone else, the pull
  -- path may not snipe the order (own offer is fine — same claim, different door).
  if exists (
    select 1 from public.dispatch_offers
    where order_id = p_order_id and status = 'offered'
      and expires_at > now() and courier_id <> v_courier_id
  ) then
    raise exception 'comanda este oferită altui curier în acest moment';
  end if;

  update public.orders set status = 'courier_assigned', courier_id = v_courier_id where id = p_order_id;
  update public.couriers set status = 'on_delivery' where id = v_courier_id;
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where (order_id = p_order_id or courier_id = v_courier_id) and status = 'offered';

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'courier_assigned', 'courier', auth.uid());
end;
$function$;
