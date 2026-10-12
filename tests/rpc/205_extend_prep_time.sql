-- "Mai am nevoie de timp" after accepting (migration 20261012000306_extend_prep_time).
-- extend_prep_time moves orders.estimated_ready_at forward by 5/10/15 min, only while
-- accepted, never past now()+60 min, only for the order's own restaurant. The customer
-- countdown reads estimated_ready_at live. Rolled back by runner.
do $$
declare
  c_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  c_foreign uuid := 'd0000000-0000-0000-0000-000000000003';
  v_order uuid; v_foreign uuid; v_before timestamptz; v_after timestamptz;
begin
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, estimated_ready_at)
  values ('standard', c_cust, c_rest, 'accepted', 'cash', 'unpaid', 200, 30, 230, now() + interval '20 minutes') returning id into v_order;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, estimated_ready_at)
  values ('standard', c_cust, c_foreign, 'accepted', 'cash', 'unpaid', 200, 30, 230, now() + interval '20 minutes') returning id into v_foreign;

  perform set_config('request.jwt.claims', json_build_object('sub', c_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- E1: +10 moves the ready time 10 min later
  select estimated_ready_at into v_before from public.orders where id = v_order;
  perform public.extend_prep_time(v_order, 10);
  select estimated_ready_at into v_after from public.orders where id = v_order;
  if v_after - v_before <> interval '10 minutes' then raise exception 'E1: moved by % (want 10 min)', v_after - v_before; end if;

  -- E2: an already-late order (ready time in the past) extends from now, not from the past
  reset role;
  update public.orders set estimated_ready_at = now() - interval '5 minutes' where id = v_order;
  set local role authenticated;
  perform public.extend_prep_time(v_order, 5);
  select estimated_ready_at into v_after from public.orders where id = v_order;
  if abs(extract(epoch from v_after - (now() + interval '5 minutes'))) > 2 then raise exception 'E2: late order extended to % (want now()+5)', v_after; end if;

  -- E3: cap — never more than 60 min from now
  reset role;
  update public.orders set estimated_ready_at = now() + interval '55 minutes' where id = v_order;
  set local role authenticated;
  begin perform public.extend_prep_time(v_order, 10); raise exception 'E3: extended past the 60-min cap';
  exception when raise_exception then if sqlerrm like 'E3:%' then raise; end if; end;

  -- E4: only 5/10/15
  begin perform public.extend_prep_time(v_order, 7); raise exception 'E4: 7 min accepted';
  exception when raise_exception then if sqlerrm like 'E4:%' then raise; end if; end;

  -- E5: only while accepted (not after ready_for_pickup)
  reset role;
  update public.orders set status = 'ready_for_pickup', estimated_ready_at = now() + interval '10 minutes' where id = v_order;
  set local role authenticated;
  begin perform public.extend_prep_time(v_order, 5); raise exception 'E5: extended a ready order';
  exception when raise_exception then if sqlerrm like 'E5:%' then raise; end if; end;

  -- E6: not another restaurant's order, not the customer
  begin perform public.extend_prep_time(v_foreign, 5); raise exception 'E6: foreign order extended';
  exception when raise_exception then if sqlerrm like 'E6:%' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  reset role;
  update public.orders set status = 'accepted' where id = v_order;
  set local role authenticated;
  begin perform public.extend_prep_time(v_order, 5); raise exception 'E6b: customer extended';
  exception when raise_exception then if sqlerrm like 'E6b:%' then raise; end if; end;

  -- E7: anon has no execute
  reset role;
  if has_function_privilege('anon', 'public.extend_prep_time(uuid,int)', 'execute') then raise exception 'E7: anon can execute'; end if;

  raise notice 'extend prep time E1-E7 OK';
end $$;
