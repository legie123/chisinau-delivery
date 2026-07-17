-- LOCAL-ONLY test accounts (never runs on remote — seeds only apply on `db reset`).
-- Password for all: parola123. Mirrors the role model so every surface is testable.
-- auth.users token columns are '' (not NULL) per the GoTrue-login gotcha.
-- Idempotent: safe to re-run / re-seed.

do $$
declare
  v_cust  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_cour  uuid := 'a0000000-0000-0000-0000-000000000002';
  v_part  uuid := 'a0000000-0000-0000-0000-000000000003';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_rest  uuid := '11111111-1111-1111-1111-111111111111'; -- sakura-sushi
  r record;
begin
  for r in
    select * from (values
      (v_cust,  'client@test.md',  'customer',           'Client Test'),
      (v_cour,  'courier@test.md', 'courier',            'Curier Test'),
      (v_part,  'partner@test.md', 'restaurant_partner', 'Partener Test'),
      (v_admin, 'admin@test.md',   'platform_admin',     'Admin Test')
    ) as t(id, email, role, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token, phone_change, phone_change_token
    ) values (
      '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email,
      extensions.crypt('parola123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('role', r.role, 'full_name', r.full_name),
      now(), now(), '', '', '', '', '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (r.id::text, r.id, jsonb_build_object('sub', r.id::text, 'email', r.email), 'email', now(), now(), now())
    on conflict (provider_id, provider) do nothing;

    -- customer profile is auto-made by the on_auth_user_created trigger; the others
    -- are created here (mirrors the admin invite flow).
    if r.role <> 'customer' then
      insert into public.profiles (id, full_name, phone, role)
      values (r.id, r.full_name, null, r.role)
      on conflict (id) do update set role = excluded.role;
    end if;
  end loop;

  -- courier row (RPCs look up couriers, not profiles)
  insert into public.couriers (user_id, full_name, phone, vehicle_type, status, is_active)
  values (v_cour, 'Curier Test', '+37360000002', 'car', 'online', true)
  on conflict do nothing;

  -- partner staffed on sakura-sushi
  insert into public.restaurant_staff (user_id, restaurant_id)
  values (v_part, v_rest)
  on conflict do nothing;
end $$;
