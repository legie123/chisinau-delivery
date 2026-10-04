-- 78: payout periods are Chisinau calendar dates (migration 20261004000600). A delivery on Monday
-- 00:30 Chisinau time is Sunday 21:30/22:30 UTC: the UTC date put it in the PREVIOUS period, while
-- the courier app and web count it in the new week. Sunday 23:30 Chisinau stays in the old week.
-- Winter (EET, UTC+2) AND summer (EEST, UTC+3): a fixed +2h offset passes winter only.
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
  w record;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select id into v_courier from public.couriers order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);

  for w in
    select * from (values
      ('winter', '2026-11-02 00:30'::timestamp, '2026-11-01 23:30'::timestamp, '2026-10-26'::date, '2026-11-01'::date, '2026-11-02'::date, '2026-11-08'::date),
      ('summer', '2026-09-28 00:30'::timestamp, '2026-09-27 23:30'::timestamp, '2026-09-21'::date, '2026-09-27'::date, '2026-09-28'::date, '2026-10-04'::date)
    ) as t(season, monday_local, sunday_local, prev_start, prev_end, this_start, this_end)
  loop
    insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                               subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
    values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 300, 20, 50, 320,
            w.monday_local at time zone 'Europe/Chisinau')
    returning id into v_monday;
    insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                               subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
    values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 300, 20, 50, 320,
            w.sunday_local at time zone 'Europe/Chisinau')
    returning id into v_sunday;

    perform public.admin_generate_payouts(w.prev_start, w.prev_end);
    select string_agg(x, ',' order by x) into v_prev from (
      select case when order_id = v_monday then 'monday' else 'sunday' end || ':' || recipient_type as x
      from public.payout_orders where order_id in (v_monday, v_sunday)) s;
    perform public.admin_generate_payouts(w.this_start, w.this_end);
    select string_agg(x, ',' order by x) into v_this from (
      select case when order_id = v_monday then 'monday' else 'sunday' end || ':' || recipient_type as x
      from public.payout_orders where order_id in (v_monday, v_sunday)) s;

    if v_prev is distinct from 'sunday:courier,sunday:restaurant' then
      raise exception 'FAIL 78.1 (%): the % - % period paid %, expected only the Sunday 23:30 order', w.season, w.prev_start, w.prev_end, v_prev;
    end if;
    if v_this is distinct from 'monday:courier,monday:restaurant,sunday:courier,sunday:restaurant' then
      raise exception 'FAIL 78.2 (%): after the % - % period the paid lines are %, expected the Monday 00:30 order added', w.season, w.this_start, w.this_end, v_this;
    end if;
  end loop;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 78: Monday 00:30 Chisinau is paid in the week that starts that Monday, winter and summer; Sunday 23:30 in the week before';
end $$;
