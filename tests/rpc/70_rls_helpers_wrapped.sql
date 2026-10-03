-- RLS helpers wrapped as initPlans (20261003000100). A bare has_role('x') / has_any_role(ARRAY[..])
-- / current_courier_id() in a policy runs once PER ROW; (SELECT ...) runs once per statement.
-- (a) catalog: no public policy holds an unwrapped constant-argument helper call;
-- (b) the only helper left bare is has_restaurant_access(<column>) — per-row by nature;
-- (c) plan: as a courier, the orders filter compares courier_id to an InitPlan, not to a
--     per-row current_courier_id() call;
-- (d) semantics, on data this sim arranges (seed-independent): the courier sees exactly its own
--     orders + the unassigned ready ones (one is planted), a customer does not see the planted
--     row, admin sees all.

do $$
declare
  c_re constant text :=
    '(?<!SELECT )\m(has_role\(''[a-z_]+''::text\)|has_any_role\(ARRAY\[''[a-z_]+''::text(, ''[a-z_]+''::text)*\]\)|current_courier_id\(\))';
  v_bad text; v_plan text := ''; v_line text;
  v_courier_user uuid := 'c0000000-0000-0000-0000-000000000007';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier uuid; v_seen bigint; v_expect bigint; v_cust uuid; v_ready uuid;
begin
  perform set_config('search_path', 'public', true);

  -- (a)
  select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname) into v_bad
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ c_re;
  if v_bad is not null then
    raise exception 'FAIL: unwrapped RLS helper call (per-row evaluation) in: %', v_bad;
  end if;
  raise notice 'PASS: no public policy holds an unwrapped has_role/has_any_role/current_courier_id call';

  -- (b) any other bare helper call must be has_restaurant_access(<column ref>)
  select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname) into v_bad
  from pg_policies
  where schemaname = 'public'
    and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                       '\mhas_restaurant_access\([a-z_.]+\)', '', 'g')
        ~ '(?<!SELECT )\m(has_role|has_any_role|current_courier_id|has_restaurant_access)\(';
  if v_bad is not null then
    raise exception 'FAIL: helper call neither wrapped nor column-bound in: %', v_bad;
  end if;
  raise notice 'PASS: only has_restaurant_access(<column>) stays per-row';

  -- arrange (superuser, rolled back by the runner): the courier owns >= 1 order, and one order
  -- not its own and not the test customer's is unassigned + ready_for_pickup
  select id into v_courier from public.couriers where user_id = v_courier_user;
  select id into v_cust from public.profiles where role = 'customer' order by id limit 1;
  if v_courier is null or v_cust is null then
    raise exception 'FAIL: seed users missing (courier % / customer %)', v_courier_user, v_cust;
  end if;
  if not exists (select 1 from public.orders where courier_id = v_courier) then
    select id into v_ready from public.orders order by created_at, id limit 1;
    update public.orders set courier_id = v_courier where id = v_ready;
  end if;
  select o.id into v_ready from public.orders o
  where o.courier_id is distinct from v_courier and o.customer_id is distinct from v_cust
  order by o.created_at, o.id limit 1;
  update public.orders set status = 'ready_for_pickup', courier_id = null where id = v_ready;

  -- (c)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_courier_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for v_line in execute 'explain (costs off) select 1 from public.orders' loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  if v_plan ~ '(?<!SELECT )current_courier_id\(\)' or v_plan !~ 'courier_id = \(InitPlan' then
    raise exception 'FAIL: orders RLS still calls current_courier_id() per row: %', v_plan;
  end if;
  raise notice 'PASS: orders RLS compares courier_id to an InitPlan';

  -- (d)
  select count(*) into v_seen from public.orders;
  if not exists (select 1 from public.orders where id = v_ready) then
    reset role;
    raise exception 'FAIL: courier does not see the planted unassigned ready order';
  end if;
  reset role;
  select count(*) into v_expect from public.orders o
  where o.courier_id = v_courier
     or (o.status = 'ready_for_pickup' and o.courier_id is null)
     or o.customer_id = v_courier_user
     or exists (select 1 from public.restaurant_staff s
                where s.restaurant_id = o.restaurant_id and s.user_id = v_courier_user);
  if v_seen <> v_expect then
    raise exception 'FAIL: courier sees % orders, expected %', v_seen, v_expect;
  end if;
  raise notice 'PASS: courier row visibility unchanged (% rows, incl. the planted ready order)', v_seen;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from public.orders where id = v_ready;
  reset role;
  if v_seen <> 0 then
    raise exception 'FAIL: a customer sees an unassigned ready order that is not theirs';
  end if;
  raise notice 'PASS: customer does not see the unassigned ready order';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from public.orders;
  reset role;
  select count(*) into v_expect from public.orders;
  if v_seen <> v_expect then
    raise exception 'FAIL: admin sees % of % orders', v_seen, v_expect;
  end if;
  raise notice 'PASS: admin sees all % orders', v_seen;
end $$;
