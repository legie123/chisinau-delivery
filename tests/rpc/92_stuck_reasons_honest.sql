-- The ready_for_pickup stuck reasons tell the truth (migration 20261011000500_stuck_reasons_honest).
-- Red-team verif-w1 on 20261011000200: D3 an old dispatch_errors row kept an order listed as
-- "Dispecerizarea eșuează" after a later offer went out; D4 a scheduled order marked ready early
-- (dispatch waits until 45 min before requested_for by design) was listed at 3 min as
-- "Fără ofertă activă"; D5 an order between two waves (offer just expired, sweeper not yet run)
-- was listed for up to 15 s, so the nav badge flickered.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_addr uuid; v_admin uuid; v_courier uuid;
  v_stale_err uuid; v_sched uuid; v_between uuid; v_real_err uuid; v_reason text;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select id into v_courier from public.couriers order by id limit 1;
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 92', 47.02, 28.83)
  returning id into v_addr;

  -- D3: error 20 minutes ago, a live offer now, order 1 minute in state.
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230, now() - interval '1 minute')
  returning id into v_stale_err;
  insert into public.dispatch_errors (order_id, phase, error_code, message, last_at, first_at)
  values (v_stale_err, 'sweep', '40P01', 'deadlock detected', now() - interval '20 minutes', now() - interval '20 minutes');
  insert into public.dispatch_offers (order_id, courier_id, score, status, expires_at)
  values (v_stale_err, v_courier, 1, 'offered', now() + interval '20 seconds');

  -- D4: scheduled 3 hours ahead, marked ready 4 minutes ago, no offer (dispatch waits by design).
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at, requested_for)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230,
          now() - interval '4 minutes', now() + interval '3 hours')
  returning id into v_sched;

  -- D5: ready 4 minutes, its offer expired 10 seconds ago (next wave due on the next sweep).
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230, now() - interval '4 minutes')
  returning id into v_between;
  insert into public.dispatch_offers (order_id, courier_id, score, status, offered_at, expires_at)
  values (v_between, v_courier, 1, 'expired', now() - interval '40 seconds', now() - interval '10 seconds');

  -- Control: a fresh error and no live offer is still listed at once (sim 89.S3 behaviour kept).
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', c_cust, v_rest, v_addr, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230, now() - interval '1 minute')
  returning id into v_real_err;
  insert into public.dispatch_errors (order_id, phase, error_code, message) values (v_real_err, 'sweep', 'P0092', 'sim92 boom');

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  if exists (select 1 from public.admin_stuck_orders where id = v_stale_err) then
    raise exception 'FAIL 92.D3: old error still lists an order that has a live offer';
  end if;
  raise notice 'PASS 92.D3: stale error with a live offer is not listed';

  select stuck_reason into v_reason from public.admin_stuck_orders where id = v_sched;
  if v_reason is not null then raise exception 'FAIL 92.D4: early-ready scheduled order listed (%)', v_reason; end if;
  raise notice 'PASS 92.D4: scheduled order waiting for its dispatch window is not listed at 3 min';

  if exists (select 1 from public.admin_stuck_orders where id = v_between) then
    raise exception 'FAIL 92.D5: order between two waves listed as stuck';
  end if;
  raise notice 'PASS 92.D5: order between waves is not listed';

  select stuck_reason into v_reason from public.admin_stuck_orders where id = v_real_err;
  if v_reason is null or v_reason not like '%sim92 boom%' then raise exception 'FAIL 92.C: fresh error not listed (%)', v_reason; end if;
  raise notice 'PASS 92.C: fresh error without a live offer still listed at once';
  reset role;
end $$;
