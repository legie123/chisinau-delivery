-- 257: pay a payee its NET pending balance, once (red-team finding on fac9997, migration
-- 20261012000409). A refund after the weekly run adds a NEGATIVE pending payout (clawback); the CSV
-- skipped it and sent the positive one whole (+105.50 MDL overpaid), and the negative stayed pending
-- for ever. admin_settle_payee(type, id, expected_net) marks ALL pending rows of the payee paid in
-- one transaction, only if their sum equals the amount that was exported and is > 0.
do $$
declare
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  v_rest uuid; v_courier uuid; v_x uuid; v_net numeric; v_pos numeric; v_n int;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select id into v_courier from public.couriers order by created_at limit 1;
  -- isolate the payee from local dev data: this sim owns every pending row of v_rest
  update public.payouts set status = 'paid', paid_at = now() where status = 'pending' and recipient_id in (v_rest, v_courier);
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 100, 20, 30, 120,
          '2028-06-07 20:00'::timestamp at time zone 'Europe/Chisinau') returning id into v_x;
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 200, 20, 30, 220,
          '2028-06-08 20:00'::timestamp at time zone 'Europe/Chisinau');
  perform public.generate_payouts_internal('2028-06-05', '2028-06-11');
  select net_mdl into v_pos from public.payouts where recipient_type = 'restaurant' and recipient_id = v_rest and status = 'pending';

  -- refund X after the run: the clawback trigger adds a negative pending row
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  perform public.admin_update_payment_status(v_x, 'refund_pending', 'sim 257');
  perform public.admin_update_payment_status(v_x, 'refunded', 'sim 257');
  select sum(net_mdl), count(*) into v_net, v_n from public.payouts
   where recipient_type = 'restaurant' and recipient_id = v_rest and status = 'pending';
  if v_n < 2 or v_net >= v_pos then raise exception 'FAIL 257.0: expected a negative clawback row (n=%, net=%, pos=%)', v_n, v_net, v_pos; end if;

  -- 257.1 settling with the old positive amount (what the old CSV sent) is refused
  begin
    perform public.admin_settle_payee('restaurant', v_rest, v_pos);
    raise exception 'FAIL 257.1: settled the positive row alone while a clawback is pending';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- 257.2 settling the net marks every pending row paid, once
  perform public.admin_settle_payee('restaurant', v_rest, v_net);
  if exists (select 1 from public.payouts where recipient_type = 'restaurant' and recipient_id = v_rest and status = 'pending') then
    raise exception 'FAIL 257.2: pending rows left after settling the net';
  end if;
  begin
    perform public.admin_settle_payee('restaurant', v_rest, v_net);
    raise exception 'FAIL 257.2: settled twice';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- 257.3 a customer cannot settle
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_settle_payee('courier', v_courier, 1);
    raise exception 'FAIL 257.3: a customer settled a payee';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 257: net settle with a pending clawback (positive alone refused, once only, admin only)';
end $$;
