-- 78: payout periods are Chisinau calendar dates (migration 20261004000600). A delivery on Monday
-- 00:30 Chisinau time is Sunday 22:30 UTC: the UTC date put it in the PREVIOUS period, while the
-- courier app and web count it in the new week. Sunday 23:30 Chisinau stays in the old week.
do $$
declare
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid;
  v_courier uuid;
  v_monday uuid;
  v_sunday uuid;
  v_prev text;
  v_this text;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select id into v_courier from public.couriers order by created_at limit 1;

  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 300, 20, 50, 320,
          '2026-11-02 00:30'::timestamp at time zone 'Europe/Chisinau')
  returning id into v_monday;
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 300, 20, 50, 320,
          '2026-11-01 23:30'::timestamp at time zone 'Europe/Chisinau')
  returning id into v_sunday;

  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  perform public.admin_generate_payouts('2026-10-26', '2026-11-01');
  select string_agg(x, ',' order by x) into v_prev from (
    select case when order_id = v_monday then 'monday' else 'sunday' end || ':' || recipient_type as x
    from public.payout_orders where order_id in (v_monday, v_sunday)) s;
  perform public.admin_generate_payouts('2026-11-02', '2026-11-08');
  select string_agg(x, ',' order by x) into v_this from (
    select case when order_id = v_monday then 'monday' else 'sunday' end || ':' || recipient_type as x
    from public.payout_orders where order_id in (v_monday, v_sunday)) s;
  perform set_config('request.jwt.claims', null, true);

  if v_prev is distinct from 'sunday:courier,sunday:restaurant' then
    raise exception 'FAIL 78.1: the 26 Oct - 1 Nov period paid %, expected only the Sunday 23:30 order', v_prev;
  end if;
  if v_this is distinct from 'monday:courier,monday:restaurant,sunday:courier,sunday:restaurant' then
    raise exception 'FAIL 78.2: after the 2-8 Nov period the paid lines are %, expected the Monday 00:30 order added', v_this;
  end if;
  raise notice 'PASS 78: Monday 00:30 Chisinau is paid in the week that starts that Monday; Sunday 23:30 in the week before';
end $$;
