-- MoneyAudit fixes (20260731000300): (1) CRIT — cash reconciliat târziu de admin
-- intră în ledger (bypass-ul "Livrat, neîncasat" închis, idempotent);
-- (2) HIGH — KPI-ul de brut/tură folosește banii curierului. Rolled back.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier_user uuid := 'c0000000-0000-0000-0000-000000000003';
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_courier uuid; v_item uuid; v_addr uuid; v_oid uuid;
  v_total numeric; n int; v_balance numeric; v_gross numeric; v_fee numeric;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;

  -- fixture: comandă cash → accepted → ready → self-claim → ... → delivered NEÎNCASAT
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  update public.restaurants set min_order_amount_mdl = 0 where id = v_rest;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;  -- deterministic: priciest modifier-free item (heap order is not stable)
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  update public.orders set status = 'cancelled', courier_id = null
    where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  update public.couriers set status = 'online', is_active = true where id = v_courier;
  update public.dispatch_offers set status = 'cancelled' where courier_id = v_courier and status = 'offered';

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  update public.dispatch_offers set status = 'cancelled' where order_id = v_oid and status = 'offered';

  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.assign_courier(v_oid);
  perform public.advance_delivery_status(v_oid, 'picked_up');
  perform public.advance_delivery_status(v_oid, 'en_route');
  perform public.advance_delivery_status(v_oid, 'delivered', false); -- "Livrat, neîncasat"

  select total_mdl into v_total from public.orders where id = v_oid;
  select count(*) into n from public.courier_cash_movements where order_id = v_oid;
  if n <> 0 then raise exception 'FAIL: accrual pe neîncasat (%)', n; end if;

  -- CRIT fix: adminul marchează paid mai târziu → ledger-ul primește rândul
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.admin_update_payment_status(v_oid, 'paid', 'încasat la sediu');
  select count(*), coalesce(sum(amount_mdl), 0) into n, v_balance
    from public.courier_cash_movements where order_id = v_oid and kind = 'collected';
  if n <> 1 then raise exception 'FAIL: rândul collected lipsă după reconciliere (%)', n; end if;
  if v_balance <> v_total then raise exception 'FAIL: suma % <> totalul %', v_balance, v_total; end if;

  -- idempotent: retransiția e no-op (same status → return), fără rând duplicat
  perform public.admin_update_payment_status(v_oid, 'paid');
  select count(*) into n from public.courier_cash_movements where order_id = v_oid and kind = 'collected';
  if n <> 1 then raise exception 'FAIL: duplicat la retransiție (%)', n; end if;

  -- HIGH fix: KPI-ul de brut/tură folosește courier_fee, nu delivery_fee
  select courier_fee_mdl into v_fee from public.orders where id = v_oid;
  update public.orders set courier_fee_mdl = v_fee + 54 where id = v_oid; -- decuplează explicit
  insert into public.courier_shifts (courier_id, started_at, ended_at)
  values (v_courier, now() - interval '3 hours', now() + interval '1 minute');
  select k.median_gross_per_shift_14d into v_gross
    from public.admin_courier_pilot_kpis k where k.courier_id = v_courier;
  select coalesce(courier_fee_mdl, delivery_fee_mdl) + coalesce(tip_mdl, 0) into v_fee
    from public.orders where id = v_oid;
  if v_gross is distinct from round(v_fee, 2) then
    raise exception 'FAIL: KPI gross % <> courier_fee-based % (folosește încă delivery_fee?)', v_gross, v_fee;
  end if;

  raise notice 'PASS money-audit-fixes: bypass-ul neîncasat închis (ledger la reconciliere, idempotent), KPI pe banii curierului';
end $$;
