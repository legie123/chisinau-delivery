-- Partial refunds (owner decision 2026-10-13, B2): an admin refunds part or all of an ONLINE
-- payment, with a mandatory reason, bounded by what is left of the order total, and the refund
-- lands in admin_audit_log with its reason. Cash / card-on-delivery money never moves here — it is
-- corrected in the cash ledger (courier_cash_movements), as before.
-- Companion (RESTAURANT request, CROSS-REQUESTS): the ADMIN cancellation paths — the
-- expire_stale_orders sweeper and cancel_order called by a platform_admin — move a captured online
-- payment ('paid' + online_gateway) to 'refund_pending', so the money owed to the customer shows up
-- in the payment queue instead of sitting as 'paid' on a cancelled order.
-- orders.refunded_mdl is the running refunded amount; payment_status becomes 'refunded' only when it
-- reaches total_mdl (the existing clawback trigger then reverses settled payouts, untouched here).

alter table public.orders add column if not exists refunded_mdl numeric not null default 0;
alter table public.orders drop constraint if exists orders_refunded_mdl_nonneg;
alter table public.orders add constraint orders_refunded_mdl_nonneg check (refunded_mdl >= 0);

create or replace function public.admin_refund_order(p_order_id uuid, p_amount_mdl numeric, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_left numeric;
  v_after numeric;
begin
  if not public.has_role('platform_admin') then
    raise exception 'Doar un administrator al platformei poate face rambursări.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Motivul rambursării este obligatoriu (minim 5 caractere).';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Comanda nu există.'; end if;

  if v_order.payment_method <> 'online_gateway' then
    raise exception 'Doar plățile online se rambursează aici — numerarul se corectează din registrul de cash.';
  end if;
  if v_order.payment_status not in ('paid', 'refund_pending') then
    raise exception 'Comanda nu are o plată încasată de rambursat (stare: %).', v_order.payment_status;
  end if;

  v_left := v_order.total_mdl - v_order.refunded_mdl;
  if p_amount_mdl is null or p_amount_mdl <= 0 or p_amount_mdl > v_left then
    raise exception 'Suma rambursată trebuie să fie între 0 și % MDL (rămas de rambursat).', v_left;
  end if;
  if round(p_amount_mdl, 2) <> p_amount_mdl then
    raise exception 'Suma se exprimă în MDL cu cel mult două zecimale.';
  end if;
  v_after := v_order.refunded_mdl + p_amount_mdl;

  -- The reason rides into admin_audit_log as _motiv (audit_admin_mutation, 20261012000490).
  perform set_config('app.audit_reason', btrim(p_reason), true);
  update public.orders
     set refunded_mdl = v_after,
         payment_status = case when v_after >= total_mdl then 'refunded' else 'refund_pending' end
   where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, v_order.status, 'platform_admin', auth.uid(),
          format('refund: %s MDL (%s/%s) — %s', to_char(p_amount_mdl, 'FM999999990.00'), to_char(v_after, 'FM999999990.00'),
                 to_char(v_order.total_mdl, 'FM999999990.00'), btrim(p_reason)));
  perform set_config('app.audit_reason', '', true);
end $$;
revoke execute on function public.admin_refund_order(uuid, numeric, text) from public, anon;
grant execute on function public.admin_refund_order(uuid, numeric, text) to authenticated;

-- Payment queue shows how much of a refund_pending order is already refunded. Recreated from the
-- live viewdef (security_invoker kept) with ONE delta: refunded_mdl.
create or replace view public.admin_payment_queue with (security_invoker = on) as
 SELECT id,
    order_number,
    status,
    payment_method,
    payment_status,
    total_mdl,
    cancellation_reason,
    created_at,
    updated_at,
    restaurant_name,
    courier_name,
    refunded_mdl
   FROM ( SELECT o.id,
            o.order_number,
            o.status,
            o.payment_method,
            o.payment_status,
            o.total_mdl,
            o.cancellation_reason,
            o.created_at,
            o.updated_at,
            r.name AS restaurant_name,
            c.full_name AS courier_name,
            o.refunded_mdl
           FROM orders o
             JOIN restaurants r ON r.id = o.restaurant_id
             LEFT JOIN couriers c ON c.id = o.courier_id
          WHERE (o.payment_status = ANY (ARRAY['refund_pending'::text, 'failed'::text])) OR (o.status = ANY (ARRAY['cancelled'::text, 'rejected'::text])) AND o.payment_status = 'paid'::text OR o.status = 'delivered'::text AND (o.payment_status <> ALL (ARRAY['paid'::text, 'refunded'::text, 'refund_pending'::text])) OR o.payment_status = 'refunded'::text AND (EXISTS ( SELECT 1
                   FROM payout_orders po
                  WHERE po.order_id = o.id))) sub
  WHERE has_role('platform_admin'::text);

-- expire_stale_orders recreated from its LIVE body (20261012000405 lineage) with ONE delta, applied
-- to both auto-cancel statements: a captured online payment goes to 'refund_pending'. The SET
-- statement_timeout clause is part of the definition and is kept (cron function).
CREATE OR REPLACE FUNCTION public.expire_stale_orders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
declare
  v_expired record;
  v_count int := 0;
begin
  for v_expired in
    select o.id
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where o.status = 'pending_restaurant'
      and o.order_type = 'standard'   -- #1: never auto-cancel catering (quote flow)
      -- scheduled orders: SLA clock starts 60 min before the requested window,
      -- never before placement (past/near requested_for degrades to ASAP behavior)
      and greatest(o.created_at, coalesce(o.requested_for - interval '60 minutes', o.created_at))
          < now() - make_interval(mins => r.accept_sla_minutes)
  loop
    update public.orders
    set status = 'cancelled',
        cancellation_reason = 'Restaurantul nu a confirmat comanda la timp — anulare automată.',
        payment_status = case when payment_status = 'paid' and payment_method = 'online_gateway' then 'refund_pending' else payment_status end
    where id = v_expired.id and status = 'pending_restaurant';
    if found then
      insert into public.delivery_status_events (order_id, status, actor_role, note)
      values (v_expired.id, 'cancelled', 'system', 'accept SLA timeout');
      v_count := v_count + 1;
    end if;
  end loop;

  -- Zombie ready orders: ready_for_pickup, no courier, ready-state entered
  -- over 6h ago, and no future scheduled window that still justifies waiting.
  for v_expired in
    select o.id
    from public.orders o
    where o.status = 'ready_for_pickup'
      and o.courier_id is null
      and coalesce(o.requested_for + interval '2 hours', now() - interval '100 years') < now()
      and coalesce(
            (select max(e.created_at) from public.delivery_status_events e
             where e.order_id = o.id and e.status = 'ready_for_pickup'),
            o.created_at
          ) < now() - make_interval(mins => (select ps.no_courier_cancel_minutes
                                              from public.platform_settings ps where ps.id))
  loop
    update public.orders
    set status = 'cancelled',
        cancellation_reason = 'Nu am găsit un curier disponibil — anulare automată. Ne pare rău.',
        payment_status = case when payment_status = 'paid' and payment_method = 'online_gateway' then 'refund_pending' else payment_status end
    where id = v_expired.id and status = 'ready_for_pickup' and courier_id is null;
    if found then
      insert into public.delivery_status_events (order_id, status, actor_role, note)
      values (v_expired.id, 'cancelled', 'system', 'no courier found — ready-order timeout');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;

-- cancel_order recreated from its LIVE body with ONE delta: when the caller is a platform_admin
-- (the admin cancel path: /platform/queues cancelStuckOrder), a captured online payment goes to
-- 'refund_pending'. A customer cancelling their own order is unchanged (CLIENT sector).
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if v_order.customer_id = auth.uid() then
    if v_order.status = 'cancelled' then return; end if;
    if v_order.status <> 'pending_restaurant' then raise exception 'too late to cancel'; end if;
  elsif not has_role('platform_admin') then
    raise exception 'not authorized';
  elsif v_order.status = 'cancelled' then return; end if;

  update public.orders set status = 'cancelled', cancellation_reason = p_reason,
    payment_status = case when has_role('platform_admin') and payment_status = 'paid' and payment_method = 'online_gateway' then 'refund_pending' else payment_status end
  where id = p_order_id;
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where order_id = p_order_id and status = 'offered';

  -- #4: if we cancelled an in-flight order, release the courier back to online.
  if v_order.status in ('courier_assigned', 'picked_up', 'en_route') and v_order.courier_id is not null then
    update public.couriers set status = 'online' where id = v_order.courier_id and status = 'on_delivery';
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'cancelled', case when has_role('platform_admin') then 'platform_admin' else 'customer' end, auth.uid(), p_reason);
end;
$function$;
