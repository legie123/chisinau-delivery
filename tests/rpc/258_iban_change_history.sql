-- 258: every IBAN change leaves a trace (red-team finding on 9c2e8db, migration 20261012000410). Any
-- restaurant_staff member (no role column) or a compromised courier account could redirect payouts and
-- the upsert overwrote the old IBAN with no record; the audit trigger zz_admin_audit logs ADMIN
-- interventions only. payout_account_changes now records every insert/update by anyone: payee, last 4
-- of the old and new IBAN (masked — no new full-IBAN copy), who, when. Admin-only read.
do $$
declare
  c_staff constant uuid := 'a0000000-0000-0000-0000-000000000003';
  c_courier_user constant uuid := 'a0000000-0000-0000-0000-000000000002';
  v_rest uuid; v_courier uuid; r record; v_n int;
begin
  select restaurant_id into v_rest from public.restaurant_staff where user_id = c_staff order by restaurant_id limit 1;
  select id into v_courier from public.couriers where user_id = c_courier_user;
  delete from public.payout_accounts where recipient_id in (v_rest, v_courier);

  perform set_config('request.jwt.claims', json_build_object('sub', c_staff, 'role', 'authenticated')::text, true);
  perform public.set_payout_account('restaurant', v_rest, 'MD24AG000225100013104168', 'Restaurant SRL');
  perform public.set_payout_account('restaurant', v_rest, 'RO49AAAA1B31007593840000', 'Altcineva SRL');
  perform set_config('request.jwt.claims', json_build_object('sub', c_courier_user, 'role', 'authenticated')::text, true);
  perform public.set_payout_account('courier', v_courier, 'MD24AG000225100013104168', 'Ion');
  perform set_config('request.jwt.claims', null, true);

  -- 258.1 the staff redirect is recorded with who and the masked old -> new
  select * into r from public.payout_account_changes
   where recipient_type = 'restaurant' and recipient_id = v_rest order by changed_at desc, id desc limit 1;
  if r is null or r.old_iban_last4 is distinct from '4168' or r.new_iban_last4 is distinct from '0000' or r.changed_by is distinct from c_staff then
    raise exception 'FAIL 258.1: staff IBAN change not recorded as 4168 -> 0000 by staff: %', row(r.old_iban_last4, r.new_iban_last4, r.changed_by);
  end if;
  select count(*) into v_n from public.payout_account_changes where recipient_id = v_rest;
  if v_n <> 2 then raise exception 'FAIL 258.1: % history rows for 2 writes', v_n; end if;
  -- 258.2 the courier's own first IBAN is recorded too (old = null)
  if not exists (select 1 from public.payout_account_changes
                 where recipient_type = 'courier' and recipient_id = v_courier and old_iban_last4 is null
                   and new_iban_last4 = '4168' and changed_by = c_courier_user) then
    raise exception 'FAIL 258.2: courier first IBAN not recorded';
  end if;
  -- 258.3 no full IBAN stored in the history
  if exists (select 1 from public.payout_account_changes where length(coalesce(new_iban_last4, '')) > 4 or length(coalesce(old_iban_last4, '')) > 4) then
    raise exception 'FAIL 258.3: history keeps more than the last 4';
  end if;
  raise notice 'PASS 258.1-3: staff and courier IBAN writes recorded (who, masked old -> new)';
end $$;

-- 258.4 admin-only read; nobody writes the history directly
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.payout_account_changes) then raise exception 'FAIL 258.4: staff reads the IBAN history'; end if;
  begin
    delete from public.payout_account_changes;
    raise exception 'FAIL 258.4: staff could delete the history';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
  if not exists (select 1 from public.payout_account_changes) then raise exception 'FAIL 258.4: admin cannot read the history'; end if;
  raise notice 'PASS 258.4: admin-only read, no direct writes or deletes';
end $$;
reset role;
do $$
begin
  if has_table_privilege('anon', 'public.payout_account_changes', 'select') then raise exception 'FAIL 258.5: anon reads history'; end if;
  raise notice 'PASS 258.5: anon locked out';
end $$;
