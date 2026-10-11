-- 254: case-by-case compensation (owner decision 2026-10-12), migration 20261012000406.
-- An admin attaches a signed amount + reason to a complaint, for the order's restaurant or courier.
-- The next payout run adds it to that payee's payout (or creates a 0-order payout for it), once.
do $$
declare
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid;
  v_courier uuid;
  v_order uuid;
  v_complaint uuid;
  v_adj uuid;
  v_adj2 uuid;
  v_payout record;
  v_n int;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  select id into v_courier from public.couriers order by created_at limit 1;
  -- a delivered order in a far-future week, so no real data mixes in
  insert into public.orders (order_type, customer_id, restaurant_id, courier_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, courier_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, v_courier, 'delivered', 'cash', 'paid', 300, 20, 50, 320,
          '2027-05-12 13:00'::timestamp at time zone 'Europe/Chisinau')
  returning id into v_order;

  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  v_complaint := public.admin_open_complaint(v_order, 'missing_item', 'Lipsea un produs');

  -- 254.1 validation: zero, above the order total, unknown payee type, non-admin
  begin
    perform public.admin_add_payout_adjustment(v_complaint, 'restaurant', 0, 'zero');
    raise exception 'FAIL 254.1: zero amount accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    perform public.admin_add_payout_adjustment(v_complaint, 'restaurant', 321, 'peste total');
    raise exception 'FAIL 254.1: amount above the order total accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_add_payout_adjustment(v_complaint, 'restaurant', 50, 'client');
    raise exception 'FAIL 254.1: a customer added an adjustment';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  raise notice 'PASS 254.1: zero, over-total and non-admin refused';

  -- 254.2 the payee comes from the order, not from the caller
  v_adj := public.admin_add_payout_adjustment(v_complaint, 'restaurant', -40, 'Produs lipsă, scăzut din plata restaurantului');
  v_adj2 := public.admin_add_payout_adjustment(v_complaint, 'courier', 25, 'Drum în plus pentru produsul lipsă');
  if (select recipient_id from public.payout_adjustments where id = v_adj) is distinct from v_rest
     or (select recipient_id from public.payout_adjustments where id = v_adj2) is distinct from v_courier then
    raise exception 'FAIL 254.2: adjustment payee is not the order''s restaurant/courier';
  end if;
  raise notice 'PASS 254.2: payee taken from the order';
  perform set_config('request.jwt.claims', null, true);

  -- 254.3 the payout run adds it to the payee's payout for that week, exactly once
  perform public.generate_payouts_internal('2027-05-10', '2027-05-16');
  select * into v_payout from public.payouts where recipient_type = 'restaurant' and recipient_id = v_rest and period_start = '2027-05-10';
  if v_payout.net_mdl <> v_payout.gross_mdl - v_payout.commission_mdl - 40 then
    raise exception 'FAIL 254.3: restaurant net % <> gross % - commission % - 40', v_payout.net_mdl, v_payout.gross_mdl, v_payout.commission_mdl;
  end if;
  if (select payout_id from public.payout_adjustments where id = v_adj) is distinct from v_payout.id then
    raise exception 'FAIL 254.3: adjustment not linked to the payout';
  end if;
  perform public.generate_payouts_internal('2027-05-10', '2027-05-16');
  perform public.generate_payouts_internal('2027-05-17', '2027-05-23');
  select count(*) into v_n from public.payouts where recipient_id in (v_rest, v_courier) and period_start in ('2027-05-10', '2027-05-17');
  if v_n <> 2 then raise exception 'FAIL 254.3: % payouts after reruns, expected 2 (adjustments counted once)', v_n; end if;
  if (select net_mdl from public.payouts where id = v_payout.id) <> v_payout.net_mdl then
    raise exception 'FAIL 254.3: rerun changed the restaurant net';
  end if;
  raise notice 'PASS 254.3: adjustment lands in the week''s payout once';

  -- 254.4 a payee with only an adjustment that week gets a 0-order payout
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  perform public.admin_resolve_complaint(v_complaint, 'Rezolvat');
  v_complaint := public.admin_open_complaint(v_order, 'late', 'Întârziere');
  v_adj := public.admin_add_payout_adjustment(v_complaint, 'restaurant', 30, 'Compensare mâncare gătită');
  perform set_config('request.jwt.claims', null, true);
  perform public.generate_payouts_internal('2027-05-24', '2027-05-30');
  select * into v_payout from public.payouts where recipient_type = 'restaurant' and recipient_id = v_rest and period_start = '2027-05-24';
  if v_payout.id is null or v_payout.orders_count <> 0 or v_payout.net_mdl <> 30 then
    raise exception 'FAIL 254.4: adjustment-only payout is %', row(v_payout.orders_count, v_payout.net_mdl);
  end if;
  raise notice 'PASS 254.4: adjustment-only week creates a 0-order payout';
end $$;

-- 254.5 no direct access for authenticated/anon; admin reads
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.payout_adjustments) then raise exception 'FAIL 254.5: a customer reads adjustments'; end if;
  begin
    insert into public.payout_adjustments (recipient_type, recipient_id, amount_mdl, reason)
    values ('restaurant', gen_random_uuid(), 10, 'direct');
    raise exception 'FAIL 254.5: direct insert allowed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
  if not exists (select 1 from public.payout_adjustments) then raise exception 'FAIL 254.5: admin cannot read adjustments'; end if;
  raise notice 'PASS 254.5: admin-only read, no direct writes';
end $$;
reset role;
do $$
begin
  if has_table_privilege('anon', 'public.payout_adjustments', 'select')
     or has_function_privilege('anon', 'public.admin_add_payout_adjustment(uuid,text,numeric,text)', 'execute') then
    raise exception 'FAIL 254.6: anon has access';
  end if;
  raise notice 'PASS 254.6: anon has no access';
end $$;
