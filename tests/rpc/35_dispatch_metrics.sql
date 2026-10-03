-- Vetted order 10, item #1 — admin_dispatch_metrics (20260727002200). Sims:
-- an admin sees exactly one row with non-null sane values (including the
-- multi-wave decline-cascade signal), a non-admin sees zero rows (the
-- explicit has_role('platform_admin') gate on the view's single output row —
-- see the view's own comment for why security_invoker + base-table RLS alone
-- can't get a bare no-GROUP-BY aggregate down to zero rows). Rolled back by runner.

-- Arrange: one fresh 2-wave order through the real RPCs, so the view's 7-day windows
-- are never empty AND the cascade path is exercised. The seed's multi-wave order V ages
-- out of the 7-day window (found 2026-10-02: last seeded delivery 2026-08-13), which
-- silently turned the cascade assertion into a no-op (multiwave-in-seed=false).
-- place -> accept -> ready (wave 1) -> wave-1 courier declines -> decline cascades
-- wave 2 to the other courier -> accept -> delivered.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_cA uuid; v_cB uuid; v_item uuid; v_addr uuid; v_oid uuid;
  v_w1 public.dispatch_offers%rowtype; v_w2 public.dispatch_offers%rowtype;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- exactly two online candidates near the restaurant
  select id into v_cA from public.couriers where user_id = 'a0000000-0000-0000-0000-000000000002';
  select id into v_cB from public.couriers where user_id = 'c0000000-0000-0000-0000-000000000001';
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id in (v_cA, v_cB) and status in ('courier_assigned','picked_up','en_route');
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select c, 'offload', -public.courier_cash_balance(c), 'sim baseline reset (rolled back)'
  from unnest(array[v_cA, v_cB]) c where public.courier_cash_balance(c) > 0;
  update public.couriers set status = 'offline' where id not in (v_cA, v_cB);
  update public.couriers set status = 'online', is_active = true where id in (v_cA, v_cB);
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_cA, 47.0245, 28.8322, now()), (v_cB, 47.03, 28.84, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);

  -- wave 1: whoever scored best declines it; the decline itself cascades wave 2
  select * into v_w1 from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_w1.id is null or v_w1.wave <> 1 then raise exception 'FAIL arrange: no wave-1 offer (wave %)', v_w1.wave; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',
    (select user_id from public.couriers where id = v_w1.courier_id),'role','authenticated')::text, true);
  perform public.decline_dispatch_offer(v_w1.id);

  select * into v_w2 from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_w2.id is null or v_w2.wave <> 2 or v_w2.courier_id = v_w1.courier_id then
    raise exception 'FAIL arrange: decline did not cascade a wave-2 offer to the other courier (wave %, same courier %)',
      v_w2.wave, v_w2.courier_id = v_w1.courier_id;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub',
    (select user_id from public.couriers where id = v_w2.courier_id),'role','authenticated')::text, true);
  perform public.accept_dispatch_offer(v_w2.id);
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
  -- independent check (not via the view) that a multi-wave dispatched order
  -- is inside the 7-day window (the arrange above guarantees one)
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
  if not v_has_multiwave then
    raise exception 'FAIL: no multi-wave dispatched order in the 7-day window — the cascade path is not exercised';
  end if;
  if v_cascade_depth <= 1 then
    raise exception 'FAIL: a multi-wave dispatched order exists but decline_cascade_depth_avg (%) does not reflect it', v_cascade_depth;
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

  raise notice 'PASS dispatch-metrics: admin sees 1 sane row (cascade depth %, multiwave=%), non-admin sees 0 rows', v_cascade_depth, v_has_multiwave;
end $$;
