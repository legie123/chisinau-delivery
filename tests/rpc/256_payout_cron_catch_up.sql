-- 256: the weekly payout run catches up (red-team finding on 93e51df, migration 20261012000408).
-- generate_weekly_payouts used to pay ONLY the previous Mon-Sun: a week whose run was missed, or a
-- cash order marked paid after its week's run (admin_update_payment_status unpaid -> paid), was never
-- paid. Now every past week with a delivered + paid order not yet in payout_orders is generated, in
-- its own Chisinau week; a rerun creates nothing.
do $$
declare
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  v_rest uuid; v_courier uuid; v_missed uuid; v_late uuid; v_n int; v_period text;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select id into v_courier from public.couriers order by created_at limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 100, 20, 30, 120,
          '2028-05-10 12:00'::timestamp at time zone 'Europe/Chisinau') returning id into v_missed;      -- week 05-08..05-14
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'unpaid', 100, 20, 30, 120,
          '2028-05-21 22:00'::timestamp at time zone 'Europe/Chisinau') returning id into v_late;        -- week 05-15..05-21

  -- 256.1 no run on 2028-05-15: the run on 05-22 still pays the 05-08..05-14 order in ITS week
  perform public.generate_weekly_payouts('2028-05-22 04:00+00');
  select string_agg(distinct p.period_start || '..' || p.period_end, ',') into v_period
  from public.payout_orders po join public.payouts p on p.id = po.payout_id where po.order_id = v_missed;
  if v_period is distinct from '2028-05-08..2028-05-14' then
    raise exception 'FAIL 256.1: the missed week''s order was paid in %, expected 2028-05-08..2028-05-14', coalesce(v_period, 'NOTHING');
  end if;
  if exists (select 1 from public.payout_orders where order_id = v_late) then
    raise exception 'FAIL 256.1: an unpaid cash order was paid out';
  end if;
  raise notice 'PASS 256.1: a missed week is paid by the next run, in its own week';

  -- 256.2 cash reconciled late: the next run pays it in its own week
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  perform public.admin_update_payment_status(v_late, 'paid', 'sim 256 late cash');
  perform set_config('request.jwt.claims', null, true);
  perform public.generate_weekly_payouts('2028-05-29 04:00+00');
  select count(*) into v_n from public.payout_orders po join public.payouts p on p.id = po.payout_id
   where po.order_id = v_late and p.period_start = '2028-05-15' and p.period_end = '2028-05-21';
  if v_n <> 2 then raise exception 'FAIL 256.2: the late-paid order has % lines in its week, expected 2', v_n; end if;
  raise notice 'PASS 256.2: an order marked paid after its week''s run is paid by the next run';

  -- 256.3 rerun: nothing new
  select public.generate_weekly_payouts('2028-05-29 04:00+00') into v_n;
  if v_n <> 0 then raise exception 'FAIL 256.3: rerun created % payouts', v_n; end if;
  raise notice 'PASS 256.3: rerun creates nothing';
end $$;
