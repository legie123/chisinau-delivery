-- device_push_tokens (migration 20261003002000) — Expo tokens for the native apps.
-- S1: A registers via the RPC and reads its own row.
-- S2: B cannot read A's token (RLS self-only).
-- S3: B cannot insert directly, nor delete A's row.
-- S4: platform admin reads every token (ops/debug).
-- S5: the phone changes hands — B registers the same token, it MOVES to B
--     (one device, one recipient: A no longer gets B's offers).
-- S6: anon cannot call the RPC; a malformed token is rejected.
--
-- Probes run under `set local role authenticated` — as postgres RLS is bypassed
-- and every visibility assert would pass falsely (lesson of sims 29/62).

do $$
declare
  v_a uuid := 'a0000000-0000-0000-0000-000000000002';      -- courier
  v_b uuid := 'c0000000-0000-0000-0000-000000000004';      -- another user
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';  -- platform_admin
  v_tok text := 'ExponentPushToken[sim72-aaaaaaaaaaaa]';
  v_rows int;
  v_owner uuid;
  v_failed boolean;
begin
  -- ===== S1 =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform public.register_device_push_token(v_tok, 'android');
  select count(*) into v_rows from public.device_push_tokens where expo_token = v_tok;
  if v_rows <> 1 then
    raise exception 'FAIL S1: A nu își vede propriul token (% rânduri)', v_rows;
  end if;
  -- idempotent re-register (every launch)
  perform public.register_device_push_token(v_tok, 'android');
  raise notice 'PASS S1: A își înregistrează și își citește tokenul (idempotent)';

  -- ===== S2 =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  select count(*) into v_rows from public.device_push_tokens where expo_token = v_tok;
  if v_rows <> 0 then
    raise exception 'FAIL S2: B citește tokenul lui A';
  end if;
  raise notice 'PASS S2: un alt utilizator nu vede tokenurile lui A';

  -- ===== S3 =====
  v_failed := false;
  begin
    insert into public.device_push_tokens (user_id, expo_token, platform)
    values (v_a, 'ExponentPushToken[sim72-forged]', 'ios');
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL S3a: B a inserat direct un token pe numele lui A';
  end if;

  delete from public.device_push_tokens where expo_token = v_tok;
  reset role;
  select count(*) into v_rows from public.device_push_tokens where expo_token = v_tok;
  if v_rows <> 1 then
    raise exception 'FAIL S3b: B a șters tokenul lui A';
  end if;
  raise notice 'PASS S3: fără insert direct, fără ștergerea rândului altcuiva';

  -- ===== S4 =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_rows from public.device_push_tokens where expo_token = v_tok;
  if v_rows <> 1 then
    raise exception 'FAIL S4: adminul nu vede tokenul';
  end if;
  raise notice 'PASS S4: platform_admin citește tokenurile';

  -- ===== S5 =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.register_device_push_token(v_tok, 'ios');
  reset role;
  select user_id into v_owner from public.device_push_tokens where expo_token = v_tok;
  if v_owner is distinct from v_b then
    raise exception 'FAIL S5: tokenul nu s-a mutat la noul utilizator (owner %)', v_owner;
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select count(*) into v_rows from public.device_push_tokens where expo_token = v_tok;
  if v_rows <> 0 then
    raise exception 'FAIL S5b: A încă vede tokenul predat lui B';
  end if;
  raise notice 'PASS S5: telefonul predat — tokenul trece la B, A nu-l mai vede';

  -- ===== S6 =====
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  v_failed := false;
  begin
    perform public.register_device_push_token('ExponentPushToken[sim72-anon]', 'ios');
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL S6a: anon a apelat register_device_push_token';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform public.register_device_push_token('not-a-token', 'ios');
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL S6b: un token invalid a fost acceptat';
  end if;
  reset role;
  raise notice 'PASS S6: anon blocat, token malformat respins';
end $$;
