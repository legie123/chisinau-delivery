-- Faza 5 #4 — referral (20260731000100): coduri unice non-null, legare
-- admin-only + write-once + fără self-referral, progres numărat corect. Rolled back.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier_user uuid := 'c0000000-0000-0000-0000-000000000003';
  v_c1 uuid; v_c2 uuid; v_code text; v_raised boolean; n int;
begin
  select id, referral_code into v_c1, v_code from public.couriers where user_id = v_courier_user;
  select id into v_c2 from public.couriers where id <> v_c1 limit 1;

  -- coduri: toate non-null și unice
  select count(*) into n from public.couriers where referral_code is null;
  if n > 0 then raise exception 'FAIL: % coduri NULL', n; end if;
  select count(*) - count(distinct referral_code) into n from public.couriers;
  if n > 0 then raise exception 'FAIL: coduri duplicate'; end if;

  -- non-admin nu poate lega
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.set_courier_referrer(v_c2, v_code); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: non-admin a legat un referral'; end if;

  -- admin: self-referral respins, legare valida merge, write-once
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.set_courier_referrer(v_c1, v_code); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: self-referral acceptat'; end if;

  perform public.set_courier_referrer(v_c2, v_code);
  perform 1 from public.couriers where id = v_c2 and referred_by = v_c1;
  if not found then raise exception 'FAIL: legarea nu s-a scris'; end if;

  v_raised := false;
  begin perform public.set_courier_referrer(v_c2, v_code); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: write-once încălcat (a doua legare a mers)'; end if;

  -- progresul apare pentru admin
  perform 1 from public.admin_referral_progress where referred_id = v_c2 and referrer_id = v_c1;
  if not found then raise exception 'FAIL: progresul nu apare în view'; end if;

  raise notice 'PASS courier-referral: coduri unice, admin-only + write-once + no-self, progres vizibil';
end $$;
