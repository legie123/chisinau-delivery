-- 250: weekly payouts run from pg_cron with no JWT (migration 20261012000401).
-- admin_generate_payouts checks has_role('platform_admin'), so under pg_cron (auth.uid() null) it
-- raised and nobody got paid unless an admin clicked. Now generate_payouts_internal holds the logic
-- (no role check, not executable by anon/authenticated) and generate_weekly_payouts(now) pays the
-- previous Monday-Sunday in Europe/Chisinau. Week of 2027-03-22: DST starts Sunday 2027-03-28 03:00,
-- so the Sunday 23:30 local order is UTC+3 and the Monday 00:30 one belongs to the next week.
do $$
declare
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid;
  v_courier uuid;
  v_sunday uuid;
  v_monday uuid;
  v_n int;
  v_lines int;
  v_paid record;
  v_after record;
  v_denied boolean;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select id into v_courier from public.couriers order by created_at limit 1;
  perform set_config('request.jwt.claims', null, true);

  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 300, 20, 50, 320,
          '2027-03-28 23:30'::timestamp at time zone 'Europe/Chisinau')
  returning id into v_sunday;
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 300, 20, 50, 320,
          '2027-03-29 00:30'::timestamp at time zone 'Europe/Chisinau')
  returning id into v_monday;

  -- 250.1 the cron entry point, no JWT, run on Monday 2027-03-29 06:00 UTC: pays 22-28 March only
  perform public.generate_weekly_payouts('2027-03-29 06:00+00');
  select count(*) into v_lines from public.payout_orders po join public.payouts p on p.id = po.payout_id
   where po.order_id = v_sunday and p.period_start = '2027-03-22' and p.period_end = '2027-03-28';
  if v_lines <> 2 then
    raise exception 'FAIL 250.1: the Sunday 23:30 order has % lines in the 22-28 March payouts, expected 2 (restaurant + courier)', v_lines;
  end if;
  if exists (select 1 from public.payout_orders where order_id = v_monday) then
    raise exception 'FAIL 250.1: the Monday 00:30 local order was paid in the previous week';
  end if;
  raise notice 'PASS 250.1: generate_weekly_payouts with no JWT pays the previous Chisinau Mon-Sun across the DST switch';

  -- 250.2 idempotent: a second run for the same week creates nothing
  select public.generate_payouts_internal('2027-03-22', '2027-03-28') into v_n;
  if v_n <> 0 then raise exception 'FAIL 250.2: rerun created % payouts, expected 0', v_n; end if;
  select count(*) into v_n from public.payouts p
   where p.period_start = '2027-03-22' and p.recipient_id in (v_rest, v_courier);
  if v_n <> 2 then raise exception 'FAIL 250.2: % payouts for the two payees, expected exactly 2', v_n; end if;
  raise notice 'PASS 250.2: rerunning the week gives no duplicate payout';

  -- 250.3 paid payouts stay untouched by a rerun, even with a new late order in the same week
  update public.payouts set status = 'paid', paid_at = now()
   where period_start = '2027-03-22' and recipient_id = v_rest returning * into v_paid;
  update public.orders set delivered_at = '2027-03-28 12:00'::timestamp at time zone 'Europe/Chisinau' where id = v_monday;
  perform public.generate_weekly_payouts('2027-03-29 06:00+00');
  select * into v_after from public.payouts where id = v_paid.id;
  if (v_after.net_mdl, v_after.orders_count, v_after.status) is distinct from (v_paid.net_mdl, v_paid.orders_count, v_paid.status) then
    raise exception 'FAIL 250.3: a paid payout changed on rerun: % -> %', row(v_paid.net_mdl, v_paid.orders_count), row(v_after.net_mdl, v_after.orders_count);
  end if;
  if not exists (select 1 from public.payout_orders po join public.payouts p on p.id = po.payout_id
                  where po.order_id = v_monday and po.recipient_type = 'restaurant' and p.id <> v_paid.id) then
    raise exception 'FAIL 250.3: the late order went unpaid or into the frozen paid payout';
  end if;
  raise notice 'PASS 250.3: a paid payout is frozen; a late order lands in a new payout';

  -- 250.4 the admin wrapper still checks the role
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_generate_payouts('2027-03-22', '2027-03-28');
    raise exception 'FAIL 250.4: a customer ran admin_generate_payouts';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  perform public.admin_generate_payouts('2027-03-22', '2027-03-28');
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 250.4: admin_generate_payouts refuses a customer and works for platform_admin';
end $$;

-- 250.5 the internal and weekly functions are not callable by anon or authenticated
do $$
declare r record;
begin
  for r in select * from (values ('anon', 'generate_payouts_internal(date,date)'), ('authenticated', 'generate_payouts_internal(date,date)'),
                                 ('anon', 'generate_weekly_payouts(timestamptz)'), ('authenticated', 'generate_weekly_payouts(timestamptz)')) t(role, fn)
  loop
    if has_function_privilege(r.role, 'public.' || r.fn, 'execute') then
      raise exception 'FAIL 250.5: % can execute %', r.role, r.fn;
    end if;
  end loop;
  raise notice 'PASS 250.5: anon and authenticated cannot execute the internal payout functions';
end $$;

set local role authenticated;
do $$
begin
  perform public.generate_payouts_internal('2027-03-22', '2027-03-28');
  raise exception 'FAIL 250.6: role authenticated ran generate_payouts_internal';
exception when insufficient_privilege then
  raise notice 'PASS 250.6: role authenticated gets permission denied';
end $$;
reset role;

-- 250.7 the weekly job is scheduled
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'weekly-payouts' and command ilike '%generate_weekly_payouts()%') then
    raise exception 'FAIL 250.7: no weekly-payouts cron job';
  end if;
  raise notice 'PASS 250.7: weekly-payouts is scheduled';
end $$;
