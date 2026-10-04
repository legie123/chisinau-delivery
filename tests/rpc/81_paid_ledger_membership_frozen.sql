-- 81: a PAID payout's lines can be neither deleted nor added, and a settled order cannot be deleted
-- out from under them (migration 20261004001000). Before it, only UPDATE was guarded: an admin
-- DELETE of a settled order cascaded the paid lines away and the header kept describing them.
do $$
declare
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_a uuid; v_b uuid; v_pid uuid; v_n int; v_msg text;
begin
  select id into v_rest from public.restaurants where is_active order by name desc limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, 'delivered', 'cash', 'paid', 400, 20, 420, '2031-03-10 12:00+00') returning id into v_a;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, delivered_at)
  values ('standard', c_cust, v_rest, 'delivered', 'cash', 'paid', 300, 20, 320, '2031-04-10 12:00+00') returning id into v_b;

  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  perform public.admin_generate_payouts('2031-03-01', '2031-03-31');
  select payout_id into v_pid from public.payout_orders where order_id = v_a and recipient_type = 'restaurant';
  if v_pid is null then raise exception 'FAIL 81.0: no restaurant line generated'; end if;

  -- a PENDING payout is still editable line by line (the generator's own path)
  delete from public.payout_orders where payout_id = v_pid and order_id = v_a;
  insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl) values (v_pid, v_a, 'restaurant', 400, 320);

  perform public.admin_mark_payout_paid(v_pid);

  begin
    delete from public.payout_orders where payout_id = v_pid and order_id = v_a;
    raise exception 'FAIL 81.1: a line of a PAID payout was deleted';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'ledger-ul de payout este imutabil%' then raise exception 'FAIL 81.1: wrong error: %', sqlerrm; end if;
  end;
  begin
    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl) values (v_pid, v_b, 'restaurant', 300, 240);
    raise exception 'FAIL 81.2: a line was added to a PAID payout';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'ledger-ul de payout este imutabil%' then raise exception 'FAIL 81.2: wrong error: %', sqlerrm; end if;
  end;
  begin
    delete from public.orders where id = v_a;
    raise exception 'FAIL 81.3: a settled order was deleted (its paid lines cascaded away)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'ledger-ul de payout este imutabil%' then raise exception 'FAIL 81.3: wrong error: %', sqlerrm; end if;
  end;
  select count(*) into v_n from public.payout_orders where payout_id = v_pid;
  if v_n <> 1 then raise exception 'FAIL 81.4: the paid payout now has % lines, expected 1', v_n; end if;
  raise notice 'PASS 81: paid payout lines cannot be added or deleted, a settled order cannot be deleted; pending payouts stay editable';
end $$;
