-- Wave B2 — the ordering customer must NOT be able to confirm their own online
-- payment. Before the fix, confirm_online_payment authorized customer_id =
-- auth.uid(), so a customer could mark their own order 'paid' with no real money
-- (free food, platform eats the commission). Now only the service role (a real
-- PSP webhook) or a platform admin may settle an intent. Rolled back by runner.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_addr uuid; v_oid uuid; v_intent uuid;
  v_pay text; v_intent_status text;
begin
  -- Arrange: open hours + an available item so place_order succeeds.
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- 1. customer places an online order + opens the payment intent (mock)
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'online_gateway',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 2)), v_addr, null, null, null, null);
  v_intent := public.start_online_payment(v_oid);

  select payment_status into v_pay from public.orders where id = v_oid;
  if v_pay <> 'pending_capture' then raise exception 'FAIL B2: after start_online_payment status % (expected pending_capture)', v_pay; end if;

  -- 2. THE EXPLOIT: customer tries to confirm their OWN payment → must be denied
  begin
    perform public.confirm_online_payment(v_intent, true, 'self-confirm-attempt');
    raise exception 'FAIL B2: customer self-confirm SUCCEEDED — exploit still open';
  exception when others then
    if sqlerrm like 'FAIL B2%' then raise; end if; -- re-raise our own assertion
    -- otherwise: the expected authorization error, good
  end;

  select payment_status into v_pay from public.orders where id = v_oid;
  select status into v_intent_status from public.payment_intents where id = v_intent;
  if v_pay = 'paid' then raise exception 'FAIL B2: order marked paid despite denied self-confirm'; end if;
  if v_intent_status <> 'pending' then raise exception 'FAIL B2: intent moved to % on denied self-confirm', v_intent_status; end if;

  -- 3. the real gateway webhook (service role) settles it → order becomes paid
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  perform public.confirm_online_payment(v_intent, true, 'psp_ref_123');

  select payment_status into v_pay from public.orders where id = v_oid;
  select status into v_intent_status from public.payment_intents where id = v_intent;
  if v_pay <> 'paid' then raise exception 'FAIL B2: service-role confirm did not mark order paid (%)', v_pay; end if;
  if v_intent_status <> 'succeeded' then raise exception 'FAIL B2: intent not succeeded after service confirm (%)', v_intent_status; end if;

  raise notice 'PASS B2: customer self-confirm DENIED (order stays unpaid); service-role webhook settles to paid';
end $$;
