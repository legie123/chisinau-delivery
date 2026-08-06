-- MARELE AUDIT 2026-08-03 — AdminOpsSectorAudit #1 (P0).
-- admin_low_ratings (20260806000000) is the founder's complaint-triage surface.
-- Proves: a platform_admin sees the low (<=3 star) ratings; any non-admin
-- authenticated user sees ZERO rows via the has_role gate baked into the view
-- (belt-and-suspenders over base-table RLS). Runner wraps in BEGIN/ROLLBACK
-- as postgres; we `set local role authenticated` + jwt claims to exercise the
-- real per-role path (a superuser session would bypass RLS entirely).

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004'; -- platform_admin
  v_cust  uuid := 'a0000000-0000-0000-0000-000000000001'; -- customer
  n_admin int; n_cust int;
begin
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into n_admin from public.admin_low_ratings;
  if n_admin < 1 then
    raise exception 'FAIL: admin sees % low ratings (expected >=1 from the seeded 3-star complaints)', n_admin;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  select count(*) into n_cust from public.admin_low_ratings;
  if n_cust <> 0 then
    raise exception 'FAIL: non-admin sees % rows in admin_low_ratings (expected 0 via has_role gate)', n_cust;
  end if;

  reset role;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS: admin_low_ratings — admin sees % complaints, non-admin sees 0', n_admin;
end $$;
