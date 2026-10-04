-- 75: an ENDED view-as token can no longer read the viewed courier's cash status (migration
-- 20261004000300). get_courier_cash_status is SECURITY DEFINER and on the viewer allowlist, so the
-- restrictive viewer_session_live policies never applied inside it.
do $$
declare
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  c_courier constant uuid := 'a0000000-0000-0000-0000-000000000002';
  v_sid uuid;
  v_n int;
  v_blocked boolean := false;
begin
  perform set_config('search_path', 'public', true);
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_sid := public.start_view_as(c_courier, 'curier', 'sim 75: numerar curier');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', c_courier, 'role', 'viewer', 'aud', 'authenticated', 'view_as_session', v_sid)::text, true);
  set local role viewer;
  select count(*) into v_n from public.get_courier_cash_status();
  reset role;
  if v_n <> 1 then raise exception 'FAIL 75.1: a live view-as session cannot read the courier cash status'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.end_view_as(v_sid);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', c_courier, 'role', 'viewer', 'aud', 'authenticated', 'view_as_session', v_sid)::text, true);
  set local role viewer;
  begin
    perform * from public.get_courier_cash_status();
  exception when insufficient_privilege then v_blocked := true;
  end;
  reset role;
  if not v_blocked then raise exception 'FAIL 75.2: an ended view-as session still reads the courier cash status'; end if;

  -- the courier's own call is unchanged
  perform set_config('request.jwt.claims', json_build_object('sub', c_courier, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.get_courier_cash_status();
  reset role;
  if v_n <> 1 then raise exception 'FAIL 75.3: the courier can no longer read their own cash status'; end if;
  raise notice 'PASS 75: cash status readable by the viewer only while the session is live; courier unchanged';
end $$;
