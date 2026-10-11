-- Courier pay on an assumed distance is no longer silent.
--
-- advance_delivery_status prices the courier's final fee as base + per_km * distance(restaurant ->
-- drop-off). When either pin is missing, haversine_km is null and the code fell back to 6.0 km
-- with no trace: on the local data 20 of 81 delivered standard orders (25%) were paid on a
-- distance nobody measured, and the web checkout still makes the pin optional. A fee built on a
-- guess looked identical to one built on a measurement, so nobody could review or correct it.
--
-- This migration changes NO amount (sim 23 keeps pinning "no address = 30 + 6*6"; what to pay
-- when the distance is unknown is a founder decision, the tariff numbers are provisional). It
-- records the fact: orders.courier_fee_distance_assumed is true exactly when the delivered fee
-- used the 6.0 km assumption, so an admin can list and review those orders.
--
-- Not covered: orders delivered BEFORE this migration (column defaults to false; they can be found
-- from the data: delivered with an unpinned address or restaurant), and the quote stamped by
-- mark_ready_for_pickup (RESTAURANT-owned; the final fee is what gets paid and is flagged here).
--
-- advance_delivery_status is recreated from its LIVE body (pg_get_functiondef, 2026-10-12) with
-- three deltas: v_dist_assumed declared, set from the null haversine before the coalesce, and
-- written next to courier_fee_mdl at 'delivered'. Signature unchanged, so CREATE OR REPLACE keeps
-- the grants. Only platform_admin can UPDATE orders directly (orders_admin_all), so the flag is as
-- tamper-proof as courier_fee_mdl.
alter table public.orders
  add column courier_fee_distance_assumed boolean not null default false;
comment on column public.orders.courier_fee_distance_assumed is
  'True when courier_fee_mdl was priced on the 6.0 km fallback because a pin was missing (set at delivered by advance_delivery_status).';

CREATE OR REPLACE FUNCTION public.advance_delivery_status(p_order_id uuid, p_new_status text, p_payment_confirmed boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_order public.orders%rowtype;
  v_allowed text[];
  v_tariff public.courier_tariff_config;
  v_r_lat numeric; v_r_lng numeric; v_a_lat numeric; v_a_lng numeric;
  v_dist_km numeric;
  v_wait_minutes numeric;
  v_final_fee numeric;
  v_dist_assumed boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if v_order.courier_id not in (select id from public.couriers where user_id = auth.uid()) and not has_role('platform_admin') then
    raise exception 'not authorized';
  end if;

  if v_order.status = p_new_status then return; end if; -- idempotent retry

  v_allowed := case v_order.status
    when 'courier_assigned' then array['picked_up']
    when 'picked_up' then array['en_route']
    when 'en_route' then array['delivered']
    else array[]::text[]
  end;
  if not (p_new_status = any(v_allowed)) then
    raise exception 'invalid transition % -> %', v_order.status, p_new_status;
  end if;

  -- MONEY GATE: a prepaid (online) order must be paid before it is handed over.
  if p_new_status = 'delivered'
     and v_order.payment_method = 'online_gateway'
     and v_order.payment_status <> 'paid' then
    raise exception 'online order % cannot be delivered before payment is confirmed (payment_status=%)',
      v_order.order_number, v_order.payment_status;
  end if;

  -- Order 2 — final courier fee, floored at the quote stamped by
  -- mark_ready_for_pickup. Distance recomputed the same way (restaurant ->
  -- delivery address, 6km fallback) in case either location changed.
  if p_new_status = 'delivered' then
    select * into v_tariff from public.current_courier_tariff();
    select lat, lng into v_r_lat, v_r_lng from public.restaurants where id = v_order.restaurant_id;
    select lat, lng into v_a_lat, v_a_lng from public.addresses where id = v_order.delivery_address_id;
    v_dist_km := public.haversine_km(v_r_lat, v_r_lng, v_a_lat, v_a_lng);
    v_dist_assumed := v_dist_km is null; -- a pin is missing at one end: the 6.0 km below is an ASSUMPTION
    v_dist_km := coalesce(v_dist_km, 6.0);
    v_wait_minutes := 0; -- observe-only ruling: fără compensare automată în pilot
    v_final_fee := round(v_tariff.base_mdl + v_tariff.per_km_mdl * v_dist_km + v_tariff.wait_per_min_mdl * v_wait_minutes
                         + coalesce(v_order.courier_fee_surcharge_mdl, 0), 2);
    v_final_fee := greatest(coalesce(v_order.courier_fee_quoted_mdl, 0), v_final_fee);
  end if;

  update public.orders
  set status = p_new_status,
      delivered_at = case when p_new_status = 'delivered' then now() else delivered_at end,
      courier_fee_mdl = case when p_new_status = 'delivered' then v_final_fee else courier_fee_mdl end,
      courier_fee_distance_assumed = case when p_new_status = 'delivered' then v_dist_assumed else courier_fee_distance_assumed end,
      payment_status = case
        when p_new_status = 'delivered' and p_payment_confirmed and payment_method <> 'online_gateway' then 'paid'
        else payment_status
      end
  where id = p_order_id;

  if p_new_status = 'delivered' then
    update public.couriers set status = 'online' where id = v_order.courier_id;
  end if;

  -- CASH FLOAT accrual (order 1 — COD-only pilot). ONLY payment_method='cash'
  -- accrues a liability: card_on_delivery settles electronically on a POS
  -- terminal and never sits in the courier's pocket. If this pushes the
  -- courier's float to/past the cap, enforce_cash_cap_offline (trigger on
  -- courier_cash_movements) forces them back offline right here.
  if p_new_status = 'delivered' and p_payment_confirmed and v_order.payment_method = 'cash' and v_order.total_mdl > 0 then
    insert into public.courier_cash_movements (courier_id, order_id, kind, amount_mdl)
    values (v_order.courier_id, v_order.id, 'collected', v_order.total_mdl);
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, p_new_status, case when has_role('courier') then 'courier' else 'platform_admin' end, auth.uid());
end;
$function$;
