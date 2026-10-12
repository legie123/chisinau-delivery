-- /platform/cash balances come from SQL (migration 20261012000493_admin_courier_cash_balances), not
-- from an app-side sum over a PostgREST response capped at 1000 rows. The view must equal
-- courier_cash_balance() for every courier, and stay admin-only like the ledger.
do $$
declare
  v_admin uuid; v_bad int; v_seen int; c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  -- 1200 extra ledger rows for one courier (more than max_rows), net +60 MDL
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select (select id from public.couriers order by id limit 1), case when g % 2 = 0 then 'collected' else 'offload' end,
         case when g % 2 = 0 then 10.05 else -10.00 end, 'sim 295'
    from generate_series(1, 1200) g;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  create temp table sim295_view on commit drop as select courier_id, balance_mdl from public.admin_courier_cash_balances;
  reset role;
  select count(*) into v_bad from public.couriers c
    left join sim295_view b on b.courier_id = c.id
   where coalesce(b.balance_mdl, 0) <> public.courier_cash_balance(c.id);
  if v_bad <> 0 then raise exception 'FAIL 295.C1: % couriers with a view balance different from courier_cash_balance()', v_bad; end if;
  raise notice 'PASS 295.C1: view = courier_cash_balance() for every courier (ledger > 1000 rows)';
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from public.admin_courier_cash_balances;
  reset role;
  if v_seen <> 0 then raise exception 'FAIL 295.C2: a customer reads % courier balances', v_seen; end if;
  raise notice 'PASS 295.C2: customer sees 0 balances';
end $$;
