-- mark_ready_for_pickup quotes the courier fee floor with NO assumed km when a pin is missing
-- (CURIER request, owner decision 2026-10-12, migration 20261012000206): the offer must not show
-- more than advance_delivery_status finally pays. One delta on the LIVE body: coalesce(..., 6.0) -> 0.
-- ROLLBACK: supabase/rollbacks/20261012000310_ready_quote_pinless.down.sql
CREATE OR REPLACE FUNCTION public.mark_ready_for_pickup(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_order public.orders%rowtype;
  v_tariff public.courier_tariff_config;
  v_r_lat numeric; v_r_lng numeric; v_a_lat numeric; v_a_lng numeric;
  v_dist_km numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status = 'ready_for_pickup' then return; end if; -- idempotent
  if v_order.status <> 'accepted' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders set status = 'ready_for_pickup' where id = p_order_id;

  -- Order 2 — quote the courier fee floor now, before dispatch offers it out.
  select lat, lng into v_r_lat, v_r_lng from public.restaurants where id = v_order.restaurant_id;
  select lat, lng into v_a_lat, v_a_lng from public.addresses where id = v_order.delivery_address_id;
  select * into v_tariff from public.current_courier_tariff();
  v_dist_km := coalesce(public.haversine_km(v_r_lat, v_r_lng, v_a_lat, v_a_lng), 0); -- no pin = base fee only (owner 2026-10-12, 000206); was 6.0
  update public.orders
    set courier_fee_quoted_mdl = round(v_tariff.base_mdl + v_tariff.per_km_mdl * v_dist_km + v_tariff.weather_surcharge_mdl, 2),
        courier_fee_surcharge_mdl = nullif(v_tariff.weather_surcharge_mdl, 0)
    where id = p_order_id;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'ready_for_pickup', (select role from public.profiles where id = auth.uid()), auth.uid());

  begin
    perform public.dispatch_order(p_order_id); -- WS2: push dispatch
  exception when others then
    raise warning 'dispatch_order(%) failed: %', p_order_id, sqlerrm; -- never block the restaurant
  end;
end;
$function$
