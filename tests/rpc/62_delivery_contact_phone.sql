-- Telefonul de contact pentru livrare (2026-08-15) + îngustarea ferestrei PII.
-- S1: curierul care are comanda ÎN LUCRU vede adresa și telefonul.
-- S2: un curier care NU are comanda nu vede rândul deloc.
-- S3: după livrare accesul ține 24h, apoi se închide (înainte era pe viață).
--
-- ATENȚIE (capcană plătită): rulat ca `postgres`, RLS e ocolit și TOATE probele
-- de vizibilitate trec fals. Ca în 29_rls_fast_path, probele se fac sub
-- `set local role authenticated`; aranjarea se face cu rolul privilegiat.

do $$
declare
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_other_user uuid := 'c0000000-0000-0000-0000-000000000004';
  v_courier uuid;
  v_rest uuid;
  v_addr uuid;
  v_order uuid;
  v_phone text;
  v_rows int;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;
  select id into v_rest from public.restaurants where is_active order by name limit 1;

  -- Adresă proprie testului: adresele seed sunt referite de mai multe comenzi,
  -- iar alt curier poate fi asignat la una dintre ele.
  insert into public.addresses (customer_id, label, street_address, sector, lat, lng, contact_phone)
  values (v_cust, 'sim62', 'str. Sim 62 nr. 1', 'Centru', 47.0235, 28.8315, '+37360123456')
  returning id into v_addr;

  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, courier_id,
                             status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_cust, v_rest, v_addr, v_courier, 'en_route', 'cash', 'unpaid', 300, 45, 345)
  returning id into v_order;

  -- ===== S1: curierul cu comanda în lucru =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user, 'role', 'authenticated')::text, true);
  select contact_phone into v_phone from public.addresses where id = v_addr;
  if v_phone is distinct from '+37360123456' then
    raise exception 'FAIL S1: curierul asignat nu vede telefonul de contact (a citit %)', coalesce(v_phone, 'NULL');
  end if;
  raise notice 'PASS S1: curierul cu livrarea în lucru vede telefonul clientului';

  -- ===== S2: alt curier =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_user, 'role', 'authenticated')::text, true);
  select count(*) into v_rows from public.addresses where id = v_addr;
  if v_rows <> 0 then
    raise exception 'FAIL S2: un curier fără comanda asta citește adresa clientului';
  end if;
  raise notice 'PASS S2: un curier străin nu vede nici adresa, nici telefonul';

  -- ===== S3: fereastra se închide la 24h după livrare =====
  reset role;
  update public.orders set status = 'delivered', delivered_at = now() - interval '2 hours' where id = v_order;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user, 'role', 'authenticated')::text, true);
  select count(*) into v_rows from public.addresses where id = v_addr;
  if v_rows <> 1 then
    raise exception 'FAIL S3a: curierul nu-și mai poate deschide livrarea de acum 2 ore';
  end if;

  reset role;
  update public.orders set delivered_at = now() - interval '30 hours' where id = v_order;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user, 'role', 'authenticated')::text, true);
  select count(*) into v_rows from public.addresses where id = v_addr;
  if v_rows <> 0 then
    raise exception 'FAIL S3b: accesul la adresa clientului a rămas deschis la 30h după livrare';
  end if;
  raise notice 'PASS S3: fereastra ține 24h după livrare, apoi se închide';

  reset role;
  perform set_config('request.jwt.claims', null, true);
end $$;
