-- Dispatch ranks in three tiers and is fair inside a tier (migration 20261011000400_dispatch_rank_tiers).
-- 20261011000300 counted a position only for 2 minutes and treated anything older like no position
-- at all, so a courier seen 3 minutes ago 0.3 km away lost to one with no position ever, purely by
-- UUID (red-team verif-w1 D1). Now: live (<= 2 min) first, then recent (<= 10 min, real distance
-- kept), then no position; inside a tier by score, then whoever was offered least recently.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_rlat numeric; v_rlng numeric; v_addr uuid;
  v_lo uuid; v_hi uuid; v_o uuid; v_offer uuid; v_to uuid; v_dist numeric; v_tmp uuid;
begin
  select id, lat, lng into v_rest, v_rlat, v_rlng from public.restaurants
  where is_active and lat is not null order by name limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 91', 47.02, 28.83)
  returning id into v_addr;
  update public.couriers set status = 'offline' where status = 'online';
  -- v_lo has the lower UUID: the old tie-break always picked it.
  select id into v_lo from public.couriers where is_active and public.courier_has_capacity(id) order by id limit 1;
  select id into v_hi from public.couriers where is_active and public.courier_has_capacity(id) and id <> v_lo order by id limit 1;
  update public.couriers set status = 'online', vehicle_type = 'bike' where id in (v_lo, v_hi);
  update public.dispatch_offers set status = 'declined' where courier_id in (v_lo, v_hi) and status = 'offered';
  delete from public.courier_locations where courier_id in (v_lo, v_hi);

  -- ===== T1: recent (3 min) 0.3 km beats no position, even with the higher UUID =====
  set local session_replication_role = replica;
  insert into public.courier_locations (courier_id, lat, lng, is_plausible, updated_at)
  values (v_hi, v_rlat + 0.0027, v_rlng, true, now() - interval '3 minutes');
  set local session_replication_role = origin;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230)
  returning id into v_o;
  v_offer := public.dispatch_order(v_o);
  select courier_id, distance_km into v_to, v_dist from public.dispatch_offers where id = v_offer;
  if v_to is distinct from v_hi then raise exception 'FAIL 91.T1: no-position courier beat a 3-min-old 0.3 km one (% got it)', v_to; end if;
  if v_dist is null or v_dist > 1 then raise exception 'FAIL 91.T1: recent real distance not stored (%)', v_dist; end if;
  raise notice 'PASS 91.T1: recent 0.3 km courier chosen over no position (stored % km)', round(v_dist, 2);
  update public.dispatch_offers set status = 'declined' where id = v_offer;

  -- ===== T2: both without position -> least recently offered wins, not the lower UUID =====
  delete from public.courier_locations where courier_id in (v_lo, v_hi);
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230)
  returning id into v_tmp;
  -- v_lo was offered something a moment ago; v_hi's last offer is older (T1 above, then pushed back).
  insert into public.dispatch_offers (order_id, courier_id, score, status, offered_at, expires_at)
  values (v_tmp, v_lo, 1, 'declined', now(), now() + interval '30 seconds');
  update public.dispatch_offers set created_at = now() - interval '1 hour' where courier_id = v_hi;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'card_on_delivery', 'unpaid', 200, 30, 230)
  returning id into v_o;
  v_offer := public.dispatch_order(v_o);
  select courier_id, distance_km into v_to, v_dist from public.dispatch_offers where id = v_offer;
  if v_to is distinct from v_hi then raise exception 'FAIL 91.T2: tie went to % (want the least recently offered %)', v_to, v_hi; end if;
  if v_dist is not null then raise exception 'FAIL 91.T2: unknown distance stored as %', v_dist; end if;
  raise notice 'PASS 91.T2: tie without positions goes to the least recently offered courier';
end $$;
