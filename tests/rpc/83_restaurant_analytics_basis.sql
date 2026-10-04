-- 83: partner analytics use the payout money basis and Chisinau time (migration 20261004001200).
-- Before: revenue = sum(total_mdl) (fee + tip included) and UTC hour / day buckets.
do $$
declare
  c_partner constant uuid := 'a0000000-0000-0000-0000-000000000003';
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_rest constant uuid := '11111111-1111-1111-1111-111111111111';
  v_at timestamptz := (date_trunc('day', now() at time zone 'UTC') - interval '2 days' + interval '22 hours 30 minutes') at time zone 'UTC';
  v_local_day date := (v_at at time zone 'Europe/Chisinau')::date;
  v_local_hour int := extract(hour from (v_at at time zone 'Europe/Chisinau'))::int;
  v_d0 numeric; v_d1 numeric; v_h0 numeric; v_h1 numeric; v_h22_0 numeric; v_h22_1 numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', c_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select revenue_mdl into v_d0 from public.restaurant_analytics_daily where restaurant_id = c_rest and day = v_local_day;
  select revenue_mdl into v_h0 from public.restaurant_analytics_hourly where restaurant_id = c_rest and hour_of_day = v_local_hour;
  select revenue_mdl into v_h22_0 from public.restaurant_analytics_hourly where restaurant_id = c_rest and hour_of_day = 22;
  reset role;

  -- subtotal 400 + fee 20 + tip 10 = total 430; ordered 22:30 UTC = 00:30 / 01:30 Chisinau (next local day)
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, tip_mdl, total_mdl, created_at, delivered_at)
  values ('standard', c_cust, c_rest, 'delivered', 'cash', 'paid', 400, 20, 10, 430, v_at, v_at + interval '40 minutes');

  set local role authenticated;
  select revenue_mdl into v_d1 from public.restaurant_analytics_daily where restaurant_id = c_rest and day = v_local_day;
  select revenue_mdl into v_h1 from public.restaurant_analytics_hourly where restaurant_id = c_rest and hour_of_day = v_local_hour;
  select revenue_mdl into v_h22_1 from public.restaurant_analytics_hourly where restaurant_id = c_rest and hour_of_day = 22;
  reset role;

  if v_d1 - v_d0 <> 400 then raise exception 'FAIL 83.1: daily revenue grew by % (food value is 400; total with fee + tip would be 430)', v_d1 - v_d0; end if;
  if v_h1 - v_h0 <> 400 then raise exception 'FAIL 83.2: the order is not in the Chisinau hour % bucket (+%)', v_local_hour, v_h1 - v_h0; end if;
  if v_h22_1 <> v_h22_0 then raise exception 'FAIL 83.3: the order still lands in the UTC hour 22 bucket'; end if;
  raise notice 'PASS 83: analytics revenue = food value (400, not 430); the 22:30 UTC order is in the Chisinau hour % bucket', v_local_hour;
end $$;
