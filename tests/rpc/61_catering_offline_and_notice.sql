-- Armata SPOF 2026-08-15 — plafonul de numerar, trei omisiuni.
-- S1: o încasare CATERING nu mai trage curierul offline (dispatch_order o
--     exceptase deja de la gate; triggerul rămăsese fără aceeași excepție, deci
--     prima livrare catering-cash reală l-ar fi ucis instant).
-- S2: dar protecția rămâne — curierul cu numerar peste plafon NU primește
--     comenzi noi (courier_has_capacity), doar că își termină tura.
-- S3: o încasare STANDARD peste plafon îl trece offline (comportament păstrat)
--     ȘI îi trimite o notificare cu motivul (înainte era complet mut).

do $$
declare
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid;
  v_rest uuid;
  v_catering_order uuid;
  v_standard_order uuid;
  v_status text;
  v_cap numeric;
  v_notices int;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  v_cap := public.effective_cash_cap(v_courier);

  -- Baseline curat: ledger la zero, curier online.
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_courier, 'refund_reversal', -public.courier_cash_balance(v_courier), 'sim 61 baseline'
  where public.courier_cash_balance(v_courier) <> 0;
  update public.couriers set status = 'online', is_active = true where id = v_courier;
  delete from public.notification_outbox where user_id = v_courier_user;

  -- ===== S1: încasare catering uriașă (peste orice plafon) =====
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('catering', 'a0000000-0000-0000-0000-000000000001', v_rest, 'delivered', 'cash', 'paid',
          9000, 0, 9000)
  returning id into v_catering_order;

  insert into public.courier_cash_movements (courier_id, order_id, kind, amount_mdl, note)
  values (v_courier, v_catering_order, 'collected', 9000, 'sim 61 — catering cash');

  select status into v_status from public.couriers where id = v_courier;
  if v_status <> 'online' then
    raise exception 'FAIL S1: curierul a fost trecut % de o încasare CATERING (dispatch o exceptă, triggerul nu)', v_status;
  end if;
  raise notice 'PASS S1: încasarea catering nu mai trece curierul offline';

  -- ===== S2: protecția rămâne — fără comenzi noi peste plafon =====
  if public.courier_has_capacity(v_courier) then
    raise exception 'FAIL S2: curierul cu 9000 MDL nepredați primește în continuare comenzi (plafon %)', v_cap;
  end if;
  raise notice 'PASS S2: protecția ține — nicio comandă nouă până predă';

  -- ===== S3: încasare STANDARD peste plafon → offline + notificare =====
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_courier, 'refund_reversal', -public.courier_cash_balance(v_courier), 'sim 61 reset';
  update public.couriers set status = 'online' where id = v_courier;
  delete from public.notification_outbox where user_id = v_courier_user;

  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', 'a0000000-0000-0000-0000-000000000001', v_rest, 'delivered', 'cash', 'paid',
          v_cap + 100, 0, v_cap + 100)
  returning id into v_standard_order;

  insert into public.courier_cash_movements (courier_id, order_id, kind, amount_mdl, note)
  values (v_courier, v_standard_order, 'collected', v_cap + 100, 'sim 61 — standard peste plafon');

  select status into v_status from public.couriers where id = v_courier;
  if v_status <> 'offline' then
    raise exception 'FAIL S3a: încasarea standard peste plafon NU a trecut curierul offline (status %)', v_status;
  end if;

  select count(*) into v_notices from public.notification_outbox
  where user_id = v_courier_user and tag = 'cash';
  if v_notices = 0 then
    raise exception 'FAIL S3b: curierul a fost trecut offline pe plafon FĂRĂ nicio notificare';
  end if;
  raise notice 'PASS S3: încasarea standard peste plafon trece offline ȘI notifică (% mesaj)', v_notices;
end $$;
