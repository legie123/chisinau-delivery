-- Vetted order 10, item #1 — admin_dispatch_metrics (20260727002200). Sims:
-- an admin sees exactly one row with non-null sane values (including the
-- multi-wave decline-cascade signal from the seed's order V), a non-admin
-- sees zero rows (the explicit has_role('platform_admin') gate on the view's
-- single output row — see the view's own comment for why security_invoker +
-- base-table RLS alone can't get a bare no-GROUP-BY aggregate down to zero
-- rows). Rolled back by runner.

-- Arrange: one fresh order through the real RPCs (same hops as 05 L1), so the view's
-- 7-day windows are never empty. Without it the sim failed whenever the seed was
-- older than 7 days (found 2026-10-02: last seeded delivery 2026-08-13).
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid; v_item uuid; v_addr uuid; v_oid uuid; v_offer uuid;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  select id into v_courier from public.couriers where user_id = v_courier_user;
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_courier, 'offload', -public.courier_cash_balance(v_courier), 'sim baseline reset (rolled back)'
  where public.courier_cash_balance(v_courier) > 0;
  update public.couriers set status = 'offline' where id <> v_courier;
  update public.couriers set status = 'online', is_active = true where id = v_courier;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier, 47.0245, 28.8322, now())
  on conflict (courier_id) do update set lat = 47.0245, lng = 28.8322, updated_at = now();

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offer is null then raise exception 'FAIL arrange: dispatch fired no offer'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.accept_dispatch_offer(v_offer);
  perform public.advance_delivery_status(v_oid, 'picked_up', null);
  perform public.advance_delivery_status(v_oid, 'en_route', null);
  perform public.advance_delivery_status(v_oid, 'delivered', true);
end $$;

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_customer uuid := 'a0000000-0000-0000-0000-000000000001';
  v_row_count int;
  v_time_to_assign int;
  v_first_offer_rate numeric;
  v_cascade_depth numeric;
  v_handover int;
  v_total_delivery numeric;
  v_unfinished_rate numeric;
  v_has_multiwave boolean;
begin
  -- independent check (not via the view) that the seed has a multi-wave
  -- dispatched order (rich_demo_04's order V: wave 1 expired, wave 2 declined)
  select exists (
    select 1 from public.dispatch_offers
    where created_at >= now() - interval '7 days'
    group by order_id having max(wave) > 1
  ) into v_has_multiwave;

  -- ==== 1. admin sees exactly one row, all values non-null and sane ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

  select count(*) into v_row_count from public.admin_dispatch_metrics;
  if v_row_count <> 1 then raise exception 'FAIL: admin sees % rows in admin_dispatch_metrics (expected 1)', v_row_count; end if;

  select time_to_assign_avg_seconds, first_offer_acceptance_rate, decline_cascade_depth_avg,
         restaurant_handover_avg_seconds, total_delivery_avg_minutes, unfinished_order_rate
    into v_time_to_assign, v_first_offer_rate, v_cascade_depth,
         v_handover, v_total_delivery, v_unfinished_rate
    from public.admin_dispatch_metrics;

  if v_time_to_assign is null or v_time_to_assign < 0 then
    raise exception 'FAIL: time_to_assign_avg_seconds not sane (%)', v_time_to_assign;
  end if;

  if v_first_offer_rate is null or v_first_offer_rate < 0 or v_first_offer_rate > 1 then
    raise exception 'FAIL: first_offer_acceptance_rate not sane (%)', v_first_offer_rate;
  end if;

  if v_cascade_depth is null or v_cascade_depth < 1 then
    raise exception 'FAIL: decline_cascade_depth_avg not sane (%)', v_cascade_depth;
  end if;
  if v_has_multiwave and v_cascade_depth <= 1 then
    raise exception 'FAIL: seed has a multi-wave dispatched order but decline_cascade_depth_avg (%) does not reflect it', v_cascade_depth;
  end if;

  if v_handover is null or v_handover < 0 then
    raise exception 'FAIL: restaurant_handover_avg_seconds not sane (%)', v_handover;
  end if;

  if v_total_delivery is null or v_total_delivery < 0 then
    raise exception 'FAIL: total_delivery_avg_minutes not sane (%)', v_total_delivery;
  end if;

  if v_unfinished_rate is null or v_unfinished_rate < 0 or v_unfinished_rate > 1 then
    raise exception 'FAIL: unfinished_order_rate not sane (%)', v_unfinished_rate;
  end if;

  -- ==== 2. non-admin (customer) gets zero rows ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer,'role','authenticated')::text, true);

  select count(*) into v_row_count from public.admin_dispatch_metrics;
  if v_row_count <> 0 then raise exception 'FAIL: non-admin sees % rows in admin_dispatch_metrics (expected 0)', v_row_count; end if;

  raise notice 'PASS dispatch-metrics: admin sees 1 sane row (cascade depth %, multiwave-in-seed=%), non-admin sees 0 rows', v_cascade_depth, v_has_multiwave;
end $$;
