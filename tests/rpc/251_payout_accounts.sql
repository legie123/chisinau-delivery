-- 251: payout IBANs (migration 20261012000402). One account per payee in payout_accounts, written
-- only via set_payout_account (owner courier, restaurant staff, or platform_admin), checksum-validated,
-- readable by the owner and admins only. MD24AG000225100013104168 is the IBAN registry MD sample.
do $$
declare
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_courier_user constant uuid := 'a0000000-0000-0000-0000-000000000002';
  c_other_courier_user constant uuid := 'c0000000-0000-0000-0000-000000000006';
  c_staff constant uuid := 'a0000000-0000-0000-0000-000000000003';
  v_courier uuid;
  v_rest uuid;
  v_n int;
  v_iban text;
begin
  select id into v_courier from public.couriers where user_id = c_courier_user;
  select restaurant_id into v_rest from public.restaurant_staff where user_id = c_staff order by restaurant_id limit 1;

  -- 251.1 the courier sets their own IBAN; spaces and lowercase are normalized
  perform set_config('request.jwt.claims', json_build_object('sub', c_courier_user, 'role', 'authenticated')::text, true);
  perform public.set_payout_account('courier', v_courier, 'md24 ag00 0225 1000 1310 4168', 'Ion Curier');
  select iban into v_iban from public.payout_accounts where recipient_type = 'courier' and recipient_id = v_courier;
  if v_iban is distinct from 'MD24AG000225100013104168' then
    raise exception 'FAIL 251.1: stored IBAN %, expected the normalized MD24AG000225100013104168', v_iban;
  end if;
  raise notice 'PASS 251.1: courier sets own IBAN, normalized';

  -- 251.2 a bad checksum is rejected, also via a direct insert (CHECK, not only the RPC)
  begin
    perform public.set_payout_account('courier', v_courier, 'MD25AG000225100013104168', 'Ion Curier');
    raise exception 'FAIL 251.2: bad checksum accepted by the RPC';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.payout_accounts (recipient_type, recipient_id, iban, holder_name)
    values ('restaurant', gen_random_uuid(), 'MD25AG000225100013104168', 'x');
    raise exception 'FAIL 251.2: bad checksum accepted by a direct insert';
  exception when check_violation then null;
  end;
  raise notice 'PASS 251.2: bad checksum rejected by RPC and CHECK';

  -- 251.3 another courier cannot write it
  perform set_config('request.jwt.claims', json_build_object('sub', c_other_courier_user, 'role', 'authenticated')::text, true);
  begin
    perform public.set_payout_account('courier', v_courier, 'RO49AAAA1B31007593840000', 'Hoț');
    raise exception 'FAIL 251.3: another courier overwrote the IBAN';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- 251.4 restaurant staff sets the restaurant IBAN; a customer cannot
  perform set_config('request.jwt.claims', json_build_object('sub', c_staff, 'role', 'authenticated')::text, true);
  perform public.set_payout_account('restaurant', v_rest, 'RO49AAAA1B31007593840000', 'Restaurant SRL');
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.set_payout_account('restaurant', v_rest, 'MD24AG000225100013104168', 'Client');
    raise exception 'FAIL 251.4: a customer wrote a restaurant IBAN';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 251.3-4: only the owner (or staff) writes; other courier and customer refused';
end $$;

-- 251.5 reads under real RLS: owner and admin see the row, others see nothing; no direct writes
-- (claims = admin first, so the courier lookup in the declare section is not hidden by RLS)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_courier uuid := (select id from public.couriers where user_id = 'a0000000-0000-0000-0000-000000000002');
  r record;
  v_n int;
begin
  for r in select * from (values
      ('a0000000-0000-0000-0000-000000000002'::uuid, 1, 'own courier'),
      ('c0000000-0000-0000-0000-000000000006'::uuid, 0, 'other courier'),
      ('a0000000-0000-0000-0000-000000000001'::uuid, 0, 'customer'),
      ('a0000000-0000-0000-0000-000000000004'::uuid, 1, 'admin')) t(uid, expected, who)
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
    select count(*) into v_n from public.payout_accounts where recipient_type = 'courier' and recipient_id = v_courier;
    if v_n <> r.expected then raise exception 'FAIL 251.5: % sees % courier account rows, expected %', r.who, v_n, r.expected; end if;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
  begin
    update public.payout_accounts set iban = 'RO49AAAA1B31007593840000' where recipient_id = v_courier;
    raise exception 'FAIL 251.5: authenticated updated payout_accounts directly';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 251.5: owner and admin read, other courier and customer see 0 rows, no direct writes';
end $$;
reset role;

-- 251.6 anon cannot reach the table or the RPC
do $$
begin
  if has_table_privilege('anon', 'public.payout_accounts', 'select')
     or has_function_privilege('anon', 'public.set_payout_account(text,uuid,text,text)', 'execute') then
    raise exception 'FAIL 251.6: anon has access to payout_accounts or set_payout_account';
  end if;
  raise notice 'PASS 251.6: anon has no access';
end $$;

-- 251.7 purge_expired_pii drops a dormant courier IBAN (3+ years, no delivery, nothing pending),
-- keeps a recent one and keeps restaurant IBANs (company data)
do $$
declare v_old uuid := gen_random_uuid(); v_new uuid := gen_random_uuid(); v_rest uuid := gen_random_uuid();
begin
  insert into public.payout_accounts (recipient_type, recipient_id, iban, holder_name, updated_at) values
    ('courier', v_old, 'MD24AG000225100013104168', 'Vechi', now() - interval '4 years'),
    ('courier', v_new, 'MD24AG000225100013104168', 'Nou', now()),
    ('restaurant', v_rest, 'MD24AG000225100013104168', 'Firma SRL', now() - interval '4 years');
  perform public.purge_expired_pii();
  if exists (select 1 from public.payout_accounts where recipient_id = v_old) then
    raise exception 'FAIL 251.7: dormant courier IBAN survived purge_expired_pii';
  end if;
  if (select count(*) from public.payout_accounts where recipient_id in (v_new, v_rest)) <> 2 then
    raise exception 'FAIL 251.7: purge removed a recent courier IBAN or a restaurant IBAN';
  end if;
  raise notice 'PASS 251.7: dormant courier IBAN purged, recent and restaurant IBANs kept';
end $$;
