-- 110: in-app account deletion (C3; App Store 5.1.1(v)), migration 20261012000107. erase_customer_pii
-- had no caller and left the login, the address phones, item notes and push tokens. delete_my_account()
-- (the customer, for themselves): refused while an order is in flight and for non-customer roles;
-- otherwise scrubs the personal data, logs out everywhere and anonymizes the auth account (email
-- replaced, password emptied, banned) — orders stay (fiscal retention; orders -> auth.users has no
-- cascade, so the user row is anonymized, not deleted).
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_o uuid; v_live uuid; v_n_before int; v_n_after int; r record;
begin
  -- a fresh customer with history (auth token columns '' — GoTrue 500s on NULL)
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sim110@test.md', 'x', now(),
          '{"full_name":"Ana Sim"}', '', '', '', '');
  insert into public.profiles (id, role, full_name, phone) values (v_uid, 'customer', 'Ana Sim', '+37369000110')
  on conflict (id) do update set role = 'customer', full_name = 'Ana Sim', phone = '+37369000110';
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng, intercom_code)
  values (v_uid, 'Str. Ana 1', '+37369000110', 47.025, 28.833, '12K');
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, notes)
  values ('standard', v_uid, v_rest, 'delivered', 'cash', 'paid', 100, 20, 120, 'sună-mă la 069000110') returning id into v_o;
  insert into public.order_items (order_id, item_name_snapshot, unit_price_mdl, quantity, line_total_mdl, notes)
  values (v_o, 'Roll', 100, 1, 100, 'pentru Ana, alergică');
  insert into public.device_push_tokens (user_id, expo_token, platform) values (v_uid, 'ExponentPushToken[sim110]', 'ios');
  insert into public.favorites (customer_id, restaurant_id) values (v_uid, v_rest);
  insert into auth.sessions (id, user_id) values (gen_random_uuid(), v_uid);
  select count(*) into v_n_before from public.orders where customer_id = v_uid;

  -- 110.1 refused while an order is in flight
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_uid, v_rest, 'en_route', 'cash', 'unpaid', 100, 20, 120) returning id into v_live;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  begin
    perform public.delete_my_account();
    raise exception 'FAIL 110.1: deleted with an order on the way';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%comandă în curs%' then raise exception 'FAIL 110.1: wrong refusal: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
  update public.orders set status = 'delivered' where id = v_live;
  raise notice 'PASS 110.1: refused while an order is in flight';

  -- 110.2 deletes: personal data gone, login gone, orders kept
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform public.delete_my_account();
  perform set_config('request.jwt.claims', null, true);
  select (select full_name from public.profiles where id = v_uid) as name,
         (select phone from public.profiles where id = v_uid) as phone,
         (select count(*) from public.addresses where customer_id = v_uid and (contact_phone is not null or intercom_code is not null or lat is not null)) as addr_pii,
         (select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id where o.customer_id = v_uid and oi.notes is not null) as item_notes,
         (select count(*) from public.orders where customer_id = v_uid and notes is not null) as order_notes,
         (select count(*) from public.device_push_tokens where user_id = v_uid) as tokens,
         (select count(*) from public.favorites where customer_id = v_uid) as favs,
         (select count(*) from auth.sessions where user_id = v_uid) as sessions,
         (select email from auth.users where id = v_uid) as email,
         (select banned_until from auth.users where id = v_uid) as banned,
         (select raw_user_meta_data from auth.users where id = v_uid) as meta
    into r;
  if r.name <> 'Utilizator șters' or r.phone is not null or r.addr_pii <> 0 or r.item_notes <> 0 or r.order_notes <> 0
     or r.tokens <> 0 or r.favs <> 0 or r.sessions <> 0 then
    raise exception 'FAIL 110.2: personal data left: %', row(r.name, r.phone, r.addr_pii, r.item_notes, r.order_notes, r.tokens, r.favs, r.sessions);
  end if;
  -- banned: far in the future but FINITE ('infinity' breaks GoTrue's user list, 20261012000111)
  if r.email like '%sim110%' or r.banned is null or r.banned = 'infinity' or r.banned < now() + interval '100 years' or r.meta::text like '%Ana%' then
    raise exception 'FAIL 110.2: login still usable or identifying: %', row(r.email, r.banned, r.meta);
  end if;
  select count(*) into v_n_after from public.orders where customer_id = v_uid;
  if v_n_after <> v_n_before + 1 then raise exception 'FAIL 110.2: orders not retained (% -> %)', v_n_before, v_n_after; end if;
  raise notice 'PASS 110.2: personal data scrubbed, login anonymized + banned, sessions gone, orders kept';
end $$;

-- 110.3 not for couriers / staff / admins (their deletion has other obligations), not for anon
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
  begin
    perform public.delete_my_account();
    raise exception 'FAIL 110.3: a courier deleted their account from the customer flow';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
  if has_function_privilege('anon', 'public.delete_my_account()', 'execute') then raise exception 'FAIL 110.3: anon can execute'; end if;
  raise notice 'PASS 110.3: customers only, anon locked out';
end $$;
