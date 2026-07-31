-- Faza 5 — Pilot Command Center (20260731000000). Admin-only, read-only,
-- 10 KPI go/no-go + 4 declanșatoare Faza 6 cu statusuri valide. Rolled back.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_raised boolean; n int; bad int;
begin
  -- non-admin: ambele funcții refuză
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_raised := false;
  begin perform * from public.admin_pilot_go_no_go(); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: non-admin a citit go/no-go'; end if;
  v_raised := false;
  begin perform * from public.admin_scaling_triggers(); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: non-admin a citit triggerele'; end if;

  -- admin: 10 rânduri KPI, statusuri doar din {pass,fail,no_data,info}
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  select count(*), count(*) filter (where g.status not in ('pass','fail','no_data','info'))
    into n, bad from public.admin_pilot_go_no_go() g;
  if n <> 10 then raise exception 'FAIL: % rânduri KPI (așteptat 10)', n; end if;
  if bad > 0 then raise exception 'FAIL: % statusuri invalide', bad; end if;

  -- admin: 4 declanșatoare, armed non-null
  select count(*), count(*) filter (where t.armed is null) into n, bad
    from public.admin_scaling_triggers() t;
  if n <> 4 then raise exception 'FAIL: % triggere (așteptat 4)', n; end if;
  if bad > 0 then raise exception 'FAIL: armed NULL pe % triggere', bad; end if;

  raise notice 'PASS pilot-command: non-admin blocat x2, 10 KPI cu statusuri valide, 4 triggere armed non-null';
end $$;
