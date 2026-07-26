-- Wave E — GDPR retention + erasure. Rolled back by runner.

-- ===== E1: scheduled retention purge (courier GPS + inactive-customer address codes) =====
do $$
declare
  v_cA uuid; v_cB uuid; v_inactive uuid := 'a0000000-0000-0000-0000-000000000004'; -- admin: no customer orders
  v_active uuid := 'a0000000-0000-0000-0000-000000000001';                          -- customer with recent orders
  v_addr_inactive uuid; v_addr_active uuid;
  v_gone int; v_kept int; v_intercom_inactive text; v_intercom_active text;
begin
  select id into v_cA from public.couriers limit 1;
  select id into v_cB from public.couriers where id <> v_cA limit 1;
  -- one stale last-known position (courier left) + one fresh
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_cA, 47.0, 28.8, now() - interval '200 days')
  on conflict (courier_id) do update set updated_at = now() - interval '200 days';
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_cB, 47.0, 28.8, now())
  on conflict (courier_id) do update set updated_at = now();

  -- an address for an INACTIVE customer (no orders in 365d) with sensitive fields
  insert into public.addresses (customer_id, street_address, intercom_code, notes)
  values (v_inactive, 'str. Test 1', '1234#', 'lasă la ușă') returning id into v_addr_inactive;
  -- an address for an ACTIVE customer (recent orders) with sensitive fields
  insert into public.addresses (customer_id, street_address, intercom_code, notes)
  values (v_active, 'str. Test 2', '9999#', 'sună la interfon') returning id into v_addr_active;

  perform set_config('request.jwt.claims', '', true);
  perform public.purge_expired_pii();

  select count(*) into v_gone from public.courier_locations where courier_id = v_cA and updated_at < now() - interval '180 days';
  select count(*) into v_kept from public.courier_locations where courier_id = v_cB;
  if v_gone <> 0 then raise exception 'FAIL E1: stale courier GPS not purged'; end if;
  if v_kept <> 1 then raise exception 'FAIL E1: fresh courier GPS was purged'; end if;

  select intercom_code into v_intercom_inactive from public.addresses where id = v_addr_inactive;
  select intercom_code into v_intercom_active from public.addresses where id = v_addr_active;
  if v_intercom_inactive is not null then raise exception 'FAIL E1: inactive customer intercom_code not redacted'; end if;
  if v_intercom_active is null then raise exception 'FAIL E1: active customer intercom_code wrongly redacted'; end if;

  raise notice 'PASS E1: stale GPS purged (fresh kept); inactive-customer access codes redacted (active kept)';
end $$;

-- ===== E2: right to erasure (admin or self), order integrity preserved =====
do $$
declare
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_other uuid := 'a0000000-0000-0000-0000-000000000002'; -- courier user, not admin
  v_name text; v_phone text; v_addr text; v_order_notes int; v_orders_before int; v_orders_after int; v_raised boolean;
begin
  -- give the customer an order note to scrub + count their orders (must survive)
  update public.orders set notes = 'sunați înainte' where customer_id = v_cust and notes is null;
  select count(*) into v_orders_before from public.orders where customer_id = v_cust;

  -- guard: a non-admin cannot erase someone else
  perform set_config('request.jwt.claims', json_build_object('sub', v_other,'role','authenticated')::text, true);
  v_raised := false;
  begin
    perform public.erase_customer_pii(v_cust);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL E2: a non-admin erased another user PII'; end if;

  -- admin erases the customer
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.erase_customer_pii(v_cust);

  select full_name, phone into v_name, v_phone from public.profiles where id = v_cust;
  select count(*) into v_order_notes from public.orders where customer_id = v_cust and notes is not null;
  select count(*) into v_orders_after from public.orders where customer_id = v_cust;
  select street_address into v_addr from public.addresses where customer_id = v_cust limit 1;

  if v_name <> 'Utilizator șters' then raise exception 'FAIL E2: name not anonymized (%)', v_name; end if;
  if v_phone is not null then raise exception 'FAIL E2: phone not cleared'; end if;
  if v_order_notes <> 0 then raise exception 'FAIL E2: order notes not scrubbed'; end if;
  if v_addr <> 'Adresă ștearsă' then raise exception 'FAIL E2: address not anonymized (%)', v_addr; end if;
  if v_orders_after <> v_orders_before then raise exception 'FAIL E2: order rows lost (% -> %)', v_orders_before, v_orders_after; end if;

  raise notice 'PASS E2: non-admin blocked; admin erasure anonymized name/phone/address/notes, all % orders preserved', v_orders_after;
end $$;
