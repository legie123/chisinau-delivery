-- submit_courier_satisfaction keys the survey on the Europe/Chisinau Monday
-- (migration 20261004000200). The courier pages look the answer up under
-- shared-domain currentWeekRange().startDate = the Chisinau Monday; the RPC
-- used the UTC-session Monday, so Mon 00:00–02:59 local landed in last week.
-- S1: the live function computes the week in Europe/Chisinau (now() cannot be
--     faked inside a transaction, so the boundary case is asserted on the body
--     plus on the expression it uses).
-- S2: Sunday 22:00 UTC = Monday 01:00 Chisinau → the NEW week's Monday.
-- S3: a real submit stores exactly the Chisinau Monday the page asks for.
do $$
declare
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid;
  v_def text;
  v_week date;
begin
  select pg_get_functiondef('public.submit_courier_satisfaction(integer, text)'::regprocedure) into v_def;
  if v_def not like '%date_trunc(''week'', now() at time zone ''Europe/Chisinau'')::date%' then
    raise exception 'FAIL S1: submit_courier_satisfaction still keys the week on the session zone';
  end if;
  raise notice 'PASS S1: survey week computed in Europe/Chisinau';

  if date_trunc('week', '2026-10-04 22:00+00'::timestamptz at time zone 'Europe/Chisinau')::date <> date '2026-10-05' then
    raise exception 'FAIL S2: Monday 01:00 Chisinau is not the new week';
  end if;
  raise notice 'PASS S2: Sunday 22:00 UTC = week of Monday 2026-10-05';

  select id into v_courier from public.couriers where user_id = v_courier_user;
  delete from public.courier_satisfaction_surveys where courier_id = v_courier;
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user, 'role', 'authenticated')::text, true);
  perform public.submit_courier_satisfaction(4);
  select week_start into v_week from public.courier_satisfaction_surveys where courier_id = v_courier;
  if v_week is distinct from date_trunc('week', now() at time zone 'Europe/Chisinau')::date then
    raise exception 'FAIL S3: stored week_start % is not the Chisinau Monday', v_week;
  end if;
  raise notice 'PASS S3: stored week_start = Chisinau Monday %', v_week;
end $$;
