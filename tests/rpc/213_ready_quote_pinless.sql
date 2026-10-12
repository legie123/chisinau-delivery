-- mark_ready_for_pickup quote with a missing pin = base fee only (migration 20261012000310). Rolled back by runner.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_uid uuid; v_o uuid; v_q numeric; v_t public.courier_tariff_config;
begin
  select user_id into v_uid from public.restaurant_staff where restaurant_id = c_rest limit 1;
  if v_uid is null then raise exception 'P0: no staff — sim proves nothing'; end if;
  select * into v_t from public.current_courier_tariff();
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, c_rest, 'accepted', 'cash', 'unpaid', 200, 30, 230) returning id into v_o;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.mark_ready_for_pickup(v_o);
  reset role;
  select courier_fee_quoted_mdl into v_q from public.orders where id = v_o;
  if v_q <> round(v_t.base_mdl + v_t.weather_surcharge_mdl, 2) then
    raise exception 'Q1: pinless quote % want base+weather %', v_q, round(v_t.base_mdl + v_t.weather_surcharge_mdl, 2);
  end if;
end $$;
