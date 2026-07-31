-- SecurityAudit hardening (20260731000500): anon revoked on 4 admin/service RPCs;
-- 8 admin_* views now carry an explicit has_role gate (a non-admin sees ZERO
-- rows even if a base-table RLS policy were broadened). Rolled back by runner.

do $$
declare
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  n int; leaked text := '';
  views text[] := array[
    'admin_fleet_status', 'admin_order_board', 'admin_payment_queue',
    'admin_restaurant_kpis', 'admin_stuck_orders', 'admin_wait_metrics',
    'admin_courier_pilot_kpis', 'admin_referral_progress'
  ];
  vw text;
begin
  -- #1: anon can no longer EXECUTE the 4 admin/service RPCs (grant surface).
  select count(*) into n from pg_proc p
  where p.proname in ('admin_mark_payout_paid','admin_update_payment_status',
                      'review_onboarding_application','confirm_online_payment')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then raise exception 'FAIL: anon still has EXECUTE on % admin/service RPCs', n; end if;

  -- #2: a CUSTOMER (non-admin) gets ZERO rows from every gated admin view — the
  -- explicit gate, independent of base-table RLS.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  foreach vw in array views loop
    execute format('select count(*) from public.%I', vw) into n;
    if n <> 0 then leaked := leaked || vw || '(' || n || ') '; end if;
  end loop;
  if leaked <> '' then raise exception 'FAIL: non-admin saw rows in gated views: %', leaked; end if;

  -- #2 (positive): the admin still sees data — the gate opens for platform_admin.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  execute 'select count(*) from public.admin_order_board' into n;
  if n = 0 then raise exception 'FAIL: admin sees zero orders on admin_order_board (gate too tight?)'; end if;
  execute 'select count(*) from public.admin_fleet_status' into n;
  if n = 0 then raise exception 'FAIL: admin sees zero couriers on admin_fleet_status'; end if;

  raise notice 'PASS security-hardening: anon revoked on 4 RPCs; 8 admin views gated (non-admin 0 rows, admin sees data)';
end $$;
