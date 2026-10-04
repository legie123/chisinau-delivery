-- 77: the admin KPI satisfaction window is floored on the Chisinau week, like the survey keys
-- (migration 20261004000500). now() cannot be moved inside a sim, so this pins the definition;
-- sim 74 pins the survey side.
do $$
declare
  v_def text := pg_get_viewdef('public.admin_courier_pilot_kpis'::regclass, true);
  v_n int;
begin
  select count(*) into v_n from regexp_matches(v_def, 'now\(\) AT TIME ZONE ''Europe/Chisinau''', 'g');
  if v_n <> 2 then
    raise exception 'FAIL 77.1: % of 2 satisfaction windows use the Chisinau week', v_n;
  end if;
  if not exists (select 1 from pg_class where oid = 'public.admin_courier_pilot_kpis'::regclass
                 and reloptions @> array['security_invoker=on']) then
    raise exception 'FAIL 77.2: admin_courier_pilot_kpis lost security_invoker';
  end if;
  if not has_table_privilege('viewer', 'public.admin_courier_pilot_kpis', 'SELECT') then
    raise exception 'FAIL 77.3: viewer lost SELECT parity on admin_courier_pilot_kpis';
  end if;
  raise notice 'PASS 77: KPI satisfaction window on the Chisinau week; security_invoker and grants kept';
end $$;
