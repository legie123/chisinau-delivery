-- Payout coverage — dezbatere 2026-08-12 BUG (P5): a delivered+paid order not
-- covered by any payout run stayed silently unpaid. admin_unpaid_delivered_orders
-- surfaces it; a generate run over its period clears it.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_courier uuid; v_item uuid; v_addr uuid; v_oid uuid; v_n int; v_n2 int;
begin
  select id into v_courier from public.couriers where user_id='a0000000-0000-0000-0000-000000000002';
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- craft a delivered+paid order LAST MONTH (outside any existing payout run)
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', null, true);
  update public.orders
  set status='delivered', payment_status='paid', courier_id=v_courier,
      delivered_at = date_trunc('month', now()) - interval '10 days',
      courier_fee_mdl = 33.33
  where id = v_oid;

  -- ===== P1: the orphan order surfaces for the admin =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  select count(*) into v_n from public.admin_unpaid_delivered_orders where id = v_oid;
  if v_n <> 1 then raise exception 'FAIL P1: uncovered delivered order invisible in coverage view (%)', v_n; end if;
  raise notice 'PASS P1: uncovered delivered+paid order surfaces in the coverage view';

  -- ===== P2: a payout run over its period clears it =====
  perform public.admin_generate_payouts(
    (date_trunc('month', now()) - interval '1 month')::date,
    (date_trunc('month', now()))::date);
  select count(*) into v_n2 from public.admin_unpaid_delivered_orders where id = v_oid;
  if v_n2 <> 0 then raise exception 'FAIL P2: order still uncovered after a payout run over its period'; end if;
  raise notice 'PASS P2: payout run over the period clears the coverage gap';

  -- ===== P3: non-admin sees nothing =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  select count(*) into v_n from public.admin_unpaid_delivered_orders;
  if v_n <> 0 then raise exception 'FAIL P3: non-admin can read the coverage view (% rows)', v_n; end if;
  raise notice 'PASS P3: coverage view is admin-only';
end $$;
