-- Admin team management (migration 20261012000492_admin_team_roles). Roles were changeable only by
-- SQL. admin_set_platform_admin(email, grant, reason) lets an admin grant/revoke platform_admin:
-- reason mandatory, never on yourself (no lockout, no self-promotion games), only a plain customer
-- can be promoted (a courier/partner keeps their couriers/restaurant_staff rows — rule 5), and the
-- change is in admin_audit_log WITH its reason.
do $$
declare
  v_admin uuid; v_target uuid := 'a0000000-0000-0000-0000-000000000001'; v_courier_email text; v_err text; v_before bigint;
  v_admin_email text; v_target_email text;
begin
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  select email into v_admin_email from auth.users where id = v_admin;
  select email into v_target_email from auth.users where id = v_target;
  select u.email into v_courier_email from auth.users u join public.profiles p on p.id = u.id where p.role = 'courier' limit 1;
  select coalesce(max(id), 0) into v_before from public.admin_audit_log;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ===== R1: grant to a customer, with reason -> role + audit with reason =====
  perform public.admin_set_platform_admin(v_target_email, true, 'sim 293: dispecer nou');
  reset role;
  if (select role from public.profiles where id = v_target) <> 'platform_admin' then raise exception 'FAIL 293.R1: grant did not apply'; end if;
  if not exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'profiles' and row_id = v_target::text
                 and actor = v_admin and new_values->>'role' = 'platform_admin' and new_values->>'_motiv' = 'sim 293: dispecer nou') then
    raise exception 'FAIL 293.R1: grant not audited with its reason';
  end if;
  raise notice 'PASS 293.R1: customer promoted, audited with reason';

  -- ===== R2: refusals — no reason, yourself, a courier, unknown email, non-admin caller =====
  set local role authenticated;
  v_err := null; begin perform public.admin_set_platform_admin(v_target_email, false, ' '); exception when others then v_err := sqlerrm; end;
  if v_err is null then reset role; raise exception 'FAIL 293.R2: revoke without reason accepted'; end if;
  v_err := null; begin perform public.admin_set_platform_admin(v_admin_email, false, 'sim 293 eu'); exception when others then v_err := sqlerrm; end;
  if v_err is null then reset role; raise exception 'FAIL 293.R2: admin changed own role'; end if;
  v_err := null; begin perform public.admin_set_platform_admin(v_courier_email, true, 'sim 293 curier'); exception when others then v_err := sqlerrm; end;
  if v_err is null then reset role; raise exception 'FAIL 293.R2: a courier was promoted'; end if;
  v_err := null; begin perform public.admin_set_platform_admin('nimeni-293@test.md', true, 'sim 293'); exception when others then v_err := sqlerrm; end;
  if v_err is null then reset role; raise exception 'FAIL 293.R2: unknown email accepted'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000c0de', 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_err := null; begin perform public.admin_set_platform_admin(v_target_email, false, 'sim 293 intrus'); exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null then raise exception 'FAIL 293.R2: non-admin changed a role'; end if;
  raise notice 'PASS 293.R2: no reason / self / courier / unknown / non-admin all refused';

  -- ===== R4: an unconfirmed (or banned / deleted) account cannot be promoted =====
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', 'f2930000-0000-0000-0000-000000000293', 'authenticated', 'authenticated',
          'neconfirmat-293@test.md', '', null, '{}', '{}', now(), now(), '', '', '', '');
  insert into public.profiles (id, full_name, role) values ('f2930000-0000-0000-0000-000000000293', 'Neconfirmat 293', 'customer')
  on conflict (id) do update set role = 'customer';
  set local role authenticated;
  v_err := null; begin perform public.admin_set_platform_admin('neconfirmat-293@test.md', true, 'sim 293 neconfirmat'); exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null then raise exception 'FAIL 293.R4: an unconfirmed account was promoted'; end if;
  raise notice 'PASS 293.R4: unconfirmed account refused (%)', v_err;

  -- ===== R5: digit runs in the reason (phone, IDNP) are masked in the audit =====
  set local role authenticated;
  perform public.admin_set_platform_admin(v_target_email, false, 'retras, sunat la 069 123 456, IDNP 2001234567890');
  reset role;
  if exists (select 1 from public.admin_audit_log where id > v_before and new_values->>'_motiv' ~ '[0-9]{5,}|069') then
    raise exception 'FAIL 293.R5: digits from the reason kept in clear in the audit log';
  end if;
  if not exists (select 1 from public.admin_audit_log where id > v_before and new_values->>'_motiv' like 'retras, sunat la ***%') then
    raise exception 'FAIL 293.R5: reason not kept (masked) in the audit log';
  end if;
  raise notice 'PASS 293.R5: reason kept, phone/IDNP masked';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_platform_admin(v_target_email, true, 'sim 293 din nou');
  reset role;

  -- ===== R3: revoke -> back to customer, audited =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_platform_admin(v_target_email, false, 'sim 293: a plecat din echipă');
  reset role;
  if (select role from public.profiles where id = v_target) <> 'customer' then raise exception 'FAIL 293.R3: revoke did not apply'; end if;
  raise notice 'PASS 293.R3: admin right revoked back to customer';
end $$;
