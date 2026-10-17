-- Admin team management (migration 20261012000492_admin_team_roles). Roles were changeable only by
-- SQL. admin_set_platform_admin(email, grant, reason) lets an admin grant/revoke platform_admin:
-- reason mandatory, never on yourself (no lockout, no self-promotion games), only a plain customer
-- can be promoted (a courier/partner keeps their couriers/restaurant_staff rows — rule 5), and the
-- change is in admin_audit_log WITH its reason. Only an account invited by an admin (auth.users.invited_at)
-- can be promoted — GoTrue auto-confirms signups, so "confirmed" alone proves nothing (round 5).
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
  update auth.users set invited_at = coalesce(invited_at, now()) where id = v_target;  -- the target was invited
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

  -- ===== R4: only an INVITED, confirmed, not banned, not deleted account can be promoted =====
  -- (a) self-registered and auto-confirmed (what GoTrue produces locally) — the look-alike attack
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, deleted_at, banned_until,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', 'f2930000-0000-0000-0000-000000000293', 'authenticated', 'authenticated', 'singur-293@test.md', '', now(), null, null, null, '{}', '{}', now(), now(), '', '', '', ''),
         ('00000000-0000-0000-0000-000000000000', 'f2930000-0000-0000-0000-000000000294', 'authenticated', 'authenticated', 'sters-293@test.md', '', now(), now(), now(), null, '{}', '{}', now(), now(), '', '', '', ''),
         ('00000000-0000-0000-0000-000000000000', 'f2930000-0000-0000-0000-000000000295', 'authenticated', 'authenticated', 'blocat-293@test.md', '', now(), now(), null, now() + interval '1 day', '{}', '{}', now(), now(), '', '', '', ''),
         ('00000000-0000-0000-0000-000000000000', 'f2930000-0000-0000-0000-000000000296', 'authenticated', 'authenticated', 'neconfirmat-293@test.md', '', null, now(), null, null, '{}', '{}', now(), now(), '', '', '', ''),
         ('00000000-0000-0000-0000-000000000000', 'f2930000-0000-0000-0000-000000000297', 'authenticated', 'authenticated', 'invitat-293@test.md', '', now(), now(), null, null, '{}', '{}', now(), now(), '', '', '', '');
  insert into public.profiles (id, full_name, role)
  select id, 'Cont 293', 'customer' from auth.users where id::text like 'f2930000-0000-0000-0000-00000000029_'
  on conflict (id) do update set role = 'customer';
  set local role authenticated;
  v_err := null; begin perform public.admin_set_platform_admin('singur-293@test.md', true, 'sim 293 autoînscris'); exception when others then v_err := sqlerrm; end;
  if v_err is null then reset role; raise exception 'FAIL 293.R4a: a self-registered (auto-confirmed) account was promoted'; end if;
  v_err := null; begin perform public.admin_set_platform_admin('sters-293@test.md', true, 'sim 293 șters'); exception when others then v_err := sqlerrm; end;
  if v_err is null then reset role; raise exception 'FAIL 293.R4b: a deleted account was promoted'; end if;
  v_err := null; begin perform public.admin_set_platform_admin('blocat-293@test.md', true, 'sim 293 blocat'); exception when others then v_err := sqlerrm; end;
  if v_err is null then reset role; raise exception 'FAIL 293.R4c: a banned account was promoted'; end if;
  v_err := null; begin perform public.admin_set_platform_admin('neconfirmat-293@test.md', true, 'sim 293 neconfirmat'); exception when others then v_err := sqlerrm; end;
  if v_err is null then reset role; raise exception 'FAIL 293.R4d: an invited but unconfirmed account was promoted'; end if;
  perform public.admin_set_platform_admin('invitat-293@test.md', true, 'sim 293 invitat, confirmat');  -- positive control
  reset role;
  if (select role from public.profiles where id = 'f2930000-0000-0000-0000-000000000297') <> 'platform_admin' then raise exception 'FAIL 293.R4e: an invited, confirmed account was not promoted'; end if;
  raise notice 'PASS 293.R4: self-registered / deleted / banned / unconfirmed refused, invited+confirmed promoted';

  -- ===== R5: identifiers in the reason are masked in the audit, the rest is kept =====
  set local role authenticated;
  perform public.admin_set_platform_admin(v_target_email, false,
    'retras, sunat la 069 123 456 și +373 69/123/456 și 069' || chr(160) || '123' || chr(160) || '456, IDNP 2001234567890, ０６９１２３４５６, ' ||
    'scris de ana.pop@firma.md; comanda CHD-2026-000123 din 12.10.2026, 1 250.50 MDL, bon #100234');
  reset role;
  select new_values->>'_motiv' into v_err from public.admin_audit_log where id > v_before and table_name = 'profiles' and row_id = v_target::text order by id desc limit 1;
  if v_err ~ '[0-9]{9,}|069|2001234567890|ana\.pop|firma\.md|０６９' then
    raise exception 'FAIL 293.R5: identifiers kept in clear in the audit log: %', v_err;
  end if;
  if v_err not like 'retras, sunat la *** și *** și ***, IDNP ***, ***, scris de ***@***; comanda CHD-2026-000123 din 12.10.2026, 1 250.50 MDL, bon #100234' then
    raise exception 'FAIL 293.R5: reason not kept readable (dates, amounts, order number): %', v_err;
  end if;
  raise notice 'PASS 293.R5: phones (spaced, /, NBSP, fullwidth, +373), IDNP, email masked; date, amount, order number kept';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_platform_admin(v_target_email, true, 'sim 293 din nou');
  reset role;

  -- ===== R6: an admin cannot be demoted through onboarding approval (last-admin lockout) =====
  reset role;
  insert into public.onboarding_applications (id, user_id, applicant_type, full_name, phone, email, details)
  values ('f2930000-0000-0000-0000-0000000002a0', v_admin, 'courier', 'Admin 293', '060000293', v_admin_email, '{"vehicle_type":"car"}');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_err := null; begin perform public.review_onboarding_application('f2930000-0000-0000-0000-0000000002a0', true, 'sim 293'); exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null or (select role from public.profiles where id = v_admin) <> 'platform_admin' then
    raise exception 'FAIL 293.R6: an admin was demoted by approving their own onboarding application (%)', coalesce(v_err, 'no error');
  end if;
  raise notice 'PASS 293.R6: onboarding approval refuses a platform_admin applicant (%)', v_err;

  -- ===== R3: revoke -> back to customer, audited =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_platform_admin(v_target_email, false, 'sim 293: a plecat din echipă');
  reset role;
  if (select role from public.profiles where id = v_target) <> 'customer' then raise exception 'FAIL 293.R3: revoke did not apply'; end if;
  raise notice 'PASS 293.R3: admin right revoked back to customer';
end $$;
