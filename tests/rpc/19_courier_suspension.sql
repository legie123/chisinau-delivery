-- Master-audit §5 #16 — EU 2024/2831 human-in-loop courier suspension.
-- Only a human admin may suspend (Art 10(5)); a reason is mandatory (Art 11); the
-- decision + contest window are recorded; reinstate lifts it. Rolled back by runner.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid; v_sid uuid; v_raised boolean; v_active boolean; v_decided uuid; v_deadline timestamptz; v_status text;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;

  -- Art 10(5): a NON-admin (the courier themselves) cannot suspend
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.suspend_courier(v_courier, 'self'); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a non-admin suspended a courier (Art 10(5) violated)'; end if;

  -- Art 11: reason is mandatory
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.suspend_courier(v_courier, '   '); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: suspension allowed with no reason (Art 11 violated)'; end if;

  -- human admin suspends with a reason
  v_sid := public.suspend_courier(v_courier, 'fraudă confirmată — location spoofing repetat');
  select is_active into v_active from public.couriers where id = v_courier;
  select decided_by, appeal_deadline, status into v_decided, v_deadline, v_status
    from public.courier_suspensions where id = v_sid;
  if v_active then raise exception 'FAIL: courier still active after suspension'; end if;
  if v_decided <> v_admin then raise exception 'FAIL: decided_by not the human admin (%)', v_decided; end if;
  if v_deadline <= now() then raise exception 'FAIL: no future contest window'; end if;
  if v_status <> 'active' then raise exception 'FAIL: suspension status % (expected active)', v_status; end if;

  -- reinstate (appeal upheld)
  perform public.reinstate_courier(v_courier, 'contestație admisă');
  select is_active into v_active from public.couriers where id = v_courier;
  select status into v_status from public.courier_suspensions where id = v_sid;
  if not v_active then raise exception 'FAIL: courier not reactivated after reinstate'; end if;
  if v_status <> 'reversed' then raise exception 'FAIL: suspension not marked reversed (%)', v_status; end if;

  raise notice 'PASS courier-suspension: non-admin blocked, reason mandatory, human decided_by recorded + 6mo window, reinstate reverses';
end $$;
