-- Order 1 (pilot-critical) — COURIER CASH FLOAT for the COD-only pilot.
-- cash_policy (versioned/immutable) + courier_cash_movements (append-only
-- ledger) + accrual hook in advance_delivery_status (cash only, never
-- card_on_delivery) + hard-cap gate in set_courier_online_status (hysteresis
-- vs the lower reactivation threshold) + record_cash_offload (admin-only).
-- Rolled back by runner.

do $$
declare
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_customer_user uuid := 'a0000000-0000-0000-0000-000000000001';
  v_courier uuid;
  v_raised boolean;
  v_balance numeric;
  v_status text;
  v_paystatus text;
  v_movement_count int;
  v_courier_row public.couriers%rowtype;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;

  -- Known baseline: no movements yet for this courier, offline, no open shift.
  delete from public.courier_cash_movements where courier_id = v_courier;
  update public.couriers set status = 'offline' where id = v_courier;
  update public.courier_shifts set ended_at = now() where courier_id = v_courier and ended_at is null;

  -- ==== 1. cash order delivered -> accrual row, seeded policy read back ====
  update public.orders
  set courier_id = v_courier, status = 'en_route', payment_method = 'cash',
      payment_status = 'unpaid', total_mdl = 345.00
  where id = 'e0000000-0000-0000-0000-000000000022';

  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.advance_delivery_status('e0000000-0000-0000-0000-000000000022'::uuid, 'delivered', true);

  select payment_status into v_paystatus from public.orders where id = 'e0000000-0000-0000-0000-000000000022';
  if v_paystatus <> 'paid' then raise exception 'FAIL: cash order not marked paid after delivery (%)', v_paystatus; end if;

  if not exists (
    select 1 from public.courier_cash_movements
    where courier_id = v_courier and order_id = 'e0000000-0000-0000-0000-000000000022' and kind = 'collected' and amount_mdl = 345.00
  ) then
    raise exception 'FAIL: no accrual row for the delivered cash order';
  end if;

  v_balance := public.courier_cash_balance(v_courier);
  if v_balance is distinct from 345.00 then raise exception 'FAIL: balance = % (expected 345.00)', v_balance; end if;

  -- get_courier_cash_status() reflects the seeded v1 policy + live balance.
  declare
    v_cash_status record;
  begin
    select * into v_cash_status from public.get_courier_cash_status();
    if v_cash_status.balance_mdl is distinct from 345.00 then
      raise exception 'FAIL: get_courier_cash_status balance = %', v_cash_status.balance_mdl;
    end if;
    if v_cash_status.cap_mdl is distinct from 1500.00 then
      raise exception 'FAIL: get_courier_cash_status cap = % (expected seeded 1500.00)', v_cash_status.cap_mdl;
    end if;
    if v_cash_status.offload_channel_text !~ 'Dragon Courier' then
      raise exception 'FAIL: offload_channel_text missing (%)', v_cash_status.offload_channel_text;
    end if;
  end;

  -- ==== 2. card_on_delivery does NOT accrue ====
  update public.orders
  set courier_id = v_courier, status = 'en_route', payment_method = 'card_on_delivery',
      payment_status = 'unpaid', total_mdl = 500.00
  where id = 'e0000000-0000-0000-0000-000000000005';

  perform public.advance_delivery_status('e0000000-0000-0000-0000-000000000005'::uuid, 'delivered', true);

  select payment_status into v_paystatus from public.orders where id = 'e0000000-0000-0000-0000-000000000005';
  if v_paystatus <> 'paid' then raise exception 'FAIL: card_on_delivery order not marked paid after delivery (%)', v_paystatus; end if;

  if exists (select 1 from public.courier_cash_movements where order_id = 'e0000000-0000-0000-0000-000000000005') then
    raise exception 'FAIL: card_on_delivery order accrued a cash movement';
  end if;

  v_balance := public.courier_cash_balance(v_courier);
  if v_balance is distinct from 345.00 then
    raise exception 'FAIL: balance changed after a card_on_delivery delivery (%, expected still 345.00)', v_balance;
  end if;

  -- ==== 3. retune the policy (admin) to a low cap so the ceiling is reachable ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.set_cash_policy(400.00, 200.00, 'Predă numerarul la sediul Dragon Courier — zilnic 09:00–21:00', now(), 'sim: low cap for test');

  -- immutability: the seeded v1 row can never be edited/deleted directly.
  v_raised := false;
  begin update public.cash_policy set cap_mdl = 1; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: cash_policy row was mutated directly (must be immutable)'; end if;

  -- ==== 4. push the float to the new (400) ceiling -> auto-offline ====
  update public.orders
  set courier_id = v_courier, status = 'en_route', payment_method = 'cash',
      payment_status = 'unpaid', total_mdl = 100.00
  where id = 'e0000000-0000-0000-0000-000000000026';

  -- courier is 'online' going into this delivery, so we can see the accrual
  -- trigger's forced-offline win over advance_delivery_status's own
  -- "delivered -> back online" line.
  update public.couriers set status = 'online' where id = v_courier;
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.advance_delivery_status('e0000000-0000-0000-0000-000000000026'::uuid, 'delivered', true);

  v_balance := public.courier_cash_balance(v_courier);
  if v_balance is distinct from 445.00 then raise exception 'FAIL: balance = % (expected 445.00 = 345+100)', v_balance; end if;

  select status into v_status from public.couriers where id = v_courier;
  if v_status <> 'offline' then raise exception 'FAIL: courier status = % (expected auto-offline at/past the 400 cap)', v_status; end if;

  -- ==== 5. balance >= cap blocks going online (P0001, short message) ====
  v_raised := false;
  begin
    perform public.set_courier_online_status('online');
  exception when others then
    v_raised := true;
    if length(sqlerrm) >= 200 then raise exception 'FAIL: cap-gate message too long (%): %', length(sqlerrm), sqlerrm; end if;
    if sqlerrm !~ 'Plafon numerar atins' then raise exception 'FAIL: unexpected cap-gate message: %', sqlerrm; end if;
  end;
  if not v_raised then raise exception 'FAIL: went online with balance (445) >= cap (400)'; end if;

  select status into v_status from public.couriers where id = v_courier;
  if v_status <> 'offline' then raise exception 'FAIL: courier went online despite the gate raising'; end if;

  -- ==== 6. non-admin offload raises ====
  v_raised := false;
  begin perform public.record_cash_offload(v_courier, 300.00, 'incerc singur'); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a non-admin recorded a cash offload'; end if;

  -- ==== 7. admin offload lowers the balance; reactivation below the LOWER
  --         threshold (200) — not merely below the cap (400) — now works ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.record_cash_offload(v_courier, 300.00, 'predare la sediu');

  v_balance := public.courier_cash_balance(v_courier);
  if v_balance is distinct from 145.00 then raise exception 'FAIL: balance after offload = % (expected 445-300=145.00)', v_balance; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.set_courier_online_status('online'); -- 145 < 200 (reactivation threshold) -> must succeed

  select status into v_status from public.couriers where id = v_courier;
  if v_status <> 'online' then raise exception 'FAIL: courier could not reactivate below the lower threshold (status=%)', v_status; end if;

  -- ==== 8. ledger is append-only: UPDATE/DELETE raises ====
  v_raised := false;
  begin update public.courier_cash_movements set amount_mdl = 1 where courier_id = v_courier; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: courier_cash_movements UPDATE succeeded (must be append-only)'; end if;

  v_raised := false;
  begin delete from public.courier_cash_movements where courier_id = v_courier; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: courier_cash_movements DELETE succeeded (must be append-only)'; end if;

  -- ==== 9. RLS: another courier cannot read this courier's ledger ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer_user,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_movement_count from public.courier_cash_movements where courier_id = v_courier;
  reset role;
  if v_movement_count <> 0 then raise exception 'FAIL: non-owner read courier_cash_movements rows (RLS leak, count=%)', v_movement_count; end if;

  -- Admin CAN read it (real RLS, not superuser bypass).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_movement_count from public.courier_cash_movements where courier_id = v_courier;
  reset role;
  if v_movement_count = 0 then raise exception 'FAIL: admin could not read courier_cash_movements (expected >0 rows)'; end if;

  raise notice 'PASS cash-float: cash delivery accrues, card_on_delivery does not, versioned policy immutable + retunable, balance>=cap blocks going online (short P0001), auto-offline on accrual, admin offload + hysteresis reactivation below the lower threshold, non-admin offload blocked, ledger append-only, RLS scopes reads to self/admin';
end $$;
