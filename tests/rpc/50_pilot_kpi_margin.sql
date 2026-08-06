-- MARELE AUDIT 2026-08-03 — MoneySectorAudit #3 (P1).
-- The go/no-go KPI is now the platform's direct delivery margin
-- (delivery_fee − courier_fee), not the meaningless courier_fee/delivery_fee
-- ratio. Proves: the old ratio KPI is gone; the new margin KPI equals an
-- independent recompute over the same window; status is a valid verdict.
-- Runner wraps in BEGIN/ROLLBACK as postgres; admin auth via jwt claims.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_cust  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_courier uuid;
  v_expected numeric; v_expected_text text; v_val text; v_status text; n int;
begin
  select id into v_rest from public.restaurants where is_active limit 1;
  select id into v_courier from public.couriers limit 1;

  -- one controlled delivered order in-window so the KPI exercises the numeric path.
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', v_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 200, 50, 30, 250, now());

  -- independent recompute over the exact same filter the KPI uses.
  select round(avg(o.delivery_fee_mdl - o.courier_fee_mdl), 2) into v_expected
  from public.orders o
  where o.status = 'delivered' and o.delivered_at >= now() - interval '14 days' and o.courier_fee_mdl is not null;
  v_expected_text := coalesce(v_expected::text || ' MDL', '—');

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select count(*) into n from public.admin_pilot_go_no_go() where kpi = 'Cota curierului din tarif';
  if n <> 0 then raise exception 'FAIL: the old meaningless ratio KPI is still present'; end if;

  select value_text, status into v_val, v_status
  from public.admin_pilot_go_no_go() where kpi = 'Marjă platformă / livrare (14d)';
  if v_val is null then raise exception 'FAIL: margin KPI row missing'; end if;
  if v_val <> v_expected_text then raise exception 'FAIL: margin KPI value "%" != independent recompute "%"', v_val, v_expected_text; end if;
  if v_status not in ('pass', 'fail', 'no_data') then raise exception 'FAIL: invalid KPI status "%"', v_status; end if;

  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS: pilot KPI is platform margin (value=%, status=%), old ratio removed', v_val, v_status;
end $$;
