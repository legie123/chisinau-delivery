-- 252: pilot support log (migration 20261012000404). Ops logs a complaint on an order (received by
-- phone), at most one OPEN complaint per order, resolves it with a written resolution. Admin-only:
-- customers, couriers, restaurants and anon cannot read or write. Notes are personal data:
-- purge_expired_pii scrubs them after 3 years.
do $$
declare
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_order uuid;
  v_c uuid;
  v_c2 uuid;
  v_row record;
begin
  select id into v_order from public.orders order by created_at desc limit 1;

  -- 252.1 admin opens a complaint; a second open one on the same order is refused
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  v_c := public.admin_open_complaint(v_order, 'missing_item', 'Lipsea un rulou Philadelphia');
  begin
    perform public.admin_open_complaint(v_order, 'late', 'A doua reclamație');
    raise exception 'FAIL 252.1: a second open complaint on the same order was accepted';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS 252.1: one open complaint per order';

  -- 252.2 resolving needs a written resolution, records who/when, then a new complaint may open
  begin
    perform public.admin_resolve_complaint(v_c, '  ');
    raise exception 'FAIL 252.2: resolved with an empty resolution';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform public.admin_resolve_complaint(v_c, 'Sunat clientul, retrimis produsul');
  select * into v_row from public.order_complaints where id = v_c;
  if v_row.status <> 'resolved' or v_row.resolved_by is distinct from c_admin or v_row.resolved_at is null then
    raise exception 'FAIL 252.2: resolution not recorded: %', row(v_row.status, v_row.resolved_by, v_row.resolved_at);
  end if;
  begin
    perform public.admin_resolve_complaint(v_c, 'din nou');
    raise exception 'FAIL 252.2: a resolved complaint was resolved again';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  v_c2 := public.admin_open_complaint(v_order, 'quality', 'Mâncare rece');
  raise notice 'PASS 252.2: resolution required and recorded once; a new complaint can follow';

  -- 252.3 a customer cannot open one
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_open_complaint(v_order, 'late', 'x x x');
    raise exception 'FAIL 252.3: a customer opened a complaint through the admin RPC';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 252.3: non-admin refused';
end $$;

-- 252.4 reads under RLS: admin sees, customer/courier/staff see nothing, no direct writes
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r record; v_n int;
begin
  for r in select * from (values
      ('a0000000-0000-0000-0000-000000000004'::uuid, true, 'admin'),
      ('a0000000-0000-0000-0000-000000000001'::uuid, false, 'customer'),
      ('a0000000-0000-0000-0000-000000000002'::uuid, false, 'courier'),
      ('a0000000-0000-0000-0000-000000000003'::uuid, false, 'restaurant staff')) t(uid, sees, who)
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
    select count(*) into v_n from public.order_complaints;
    if (v_n > 0) <> r.sees then raise exception 'FAIL 252.4: % sees % complaint rows', r.who, v_n; end if;
  end loop;
  begin
    insert into public.order_complaints (order_id, kind, note) select id, 'other', 'direct' from public.orders limit 1;
    raise exception 'FAIL 252.4: authenticated inserted directly';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 252.4: admin-only read, no direct writes';
end $$;
reset role;

-- 252.5 anon has nothing; purge scrubs notes older than 3 years
do $$
declare v_old uuid; v_order uuid;
begin
  if has_table_privilege('anon', 'public.order_complaints', 'select')
     or has_function_privilege('anon', 'public.admin_open_complaint(uuid,text,text)', 'execute')
     or has_function_privilege('anon', 'public.admin_resolve_complaint(uuid,text)', 'execute') then
    raise exception 'FAIL 252.5: anon has access';
  end if;
  select id into v_order from public.orders order by created_at limit 1;
  insert into public.order_complaints (order_id, kind, note, status, resolution, created_at, resolved_at)
  values (v_order, 'other', 'Clientul Ion, tel 069000000', 'resolved', 'Rambursat parțial, Ion',
          now() - interval '4 years', now() - interval '4 years')
  returning id into v_old;
  perform public.purge_expired_pii();
  if exists (select 1 from public.order_complaints where id = v_old and (note <> '[șters]' or resolution <> '[șters]')) then
    raise exception 'FAIL 252.5: a 4-year-old complaint kept its note/resolution';
  end if;
  raise notice 'PASS 252.5: anon has no access; old complaint text scrubbed';
end $$;
