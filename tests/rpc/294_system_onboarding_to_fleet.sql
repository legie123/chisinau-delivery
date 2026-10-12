-- SYSTEM (cross-sector, written by ADMIN as the consumer): onboarding -> operable courier -> suspension.
-- A customer applies as courier from her own account (/devino-partener); the admin approves; the
-- SAME account (same login) is now a courier who can go online and is eligible for offers. The
-- admin suspends (reason mandatory): offline, live offers cancelled, cannot come back online;
-- reinstate restores it. Every admin step is in admin_audit_log.
-- Behaviour owners: ADMIN (review_onboarding_application, suspend/reinstate_courier),
-- CURIER (set_courier_online_status). Red here is fixed by the owner, never by editing this file.
do $$
declare
  c_user uuid := 'a0000000-0000-0000-0000-000000000001';   -- client@test.md
  v_admin uuid; v_app uuid; v_cid uuid; v_err text; v_before bigint;
begin
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  select coalesce(max(id), 0) into v_before from public.admin_audit_log;
  update public.onboarding_applications set status = 'rejected' where user_id = c_user and status = 'pending';

  -- applicant (her own session)
  perform set_config('request.jwt.claims', json_build_object('sub', c_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_app := public.submit_onboarding_application('courier', 'Ana Sim294', '069294294', 'ana294@test.md', '{"vehicle_type":"bike"}');
  reset role;

  -- ===== O1: admin approves -> the same account is a courier =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.review_onboarding_application(v_app, true, 'sim 294 aprobat');
  reset role;
  select id into v_cid from public.couriers where user_id = c_user;
  if v_cid is null or (select role from public.profiles where id = c_user) <> 'courier' then
    raise exception 'FAIL 294.O1: approval did not turn the applicant account into a courier';
  end if;
  raise notice 'PASS 294.O1: approved application -> courier % on the applicant''s own account', v_cid;

  -- ===== O2: that account can go online (courier app login = same credentials) =====
  perform set_config('request.jwt.claims', json_build_object('sub', c_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_courier_online_status('online');
  reset role;
  if (select status from public.couriers where id = v_cid) <> 'online' then
    raise exception 'FAIL 294.O2: the new courier could not go online';
  end if;
  raise notice 'PASS 294.O2: new courier is online';

  -- ===== O3: suspension takes him off the fleet and keeps him off =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.suspend_courier(v_cid, 'sim 294: documente expirate');
  reset role;
  if (select status from public.couriers where id = v_cid) <> 'offline' or (select is_active from public.couriers where id = v_cid) then
    raise exception 'FAIL 294.O3: suspended courier still active/online';
  end if;
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', c_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_courier_online_status('online'); exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null and (select status from public.couriers where id = v_cid) = 'online' then
    raise exception 'FAIL 294.O3: a suspended courier went back online';
  end if;
  raise notice 'PASS 294.O3: suspended -> offline, inactive, cannot go online (%)', coalesce(v_err, 'stayed offline');

  -- ===== O4: reinstate restores him; all admin steps audited =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reinstate_courier(v_cid, 'sim 294: documente reînnoite');
  reset role;
  if not (select is_active from public.couriers where id = v_cid) then raise exception 'FAIL 294.O4: reinstate did not reactivate'; end if;
  if not exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'onboarding_applications' and actor = v_admin)
     or not exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'couriers' and actor = v_admin and new_values ? 'is_active')
     or not exists (select 1 from public.admin_audit_log where id > v_before and table_name = 'profiles' and new_values->>'role' = 'courier') then
    raise exception 'FAIL 294.O4: approval / suspension / role change missing from the admin audit trail';
  end if;
  raise notice 'PASS 294.O4: reinstated; approval, role change and suspension all audited';
end $$;
