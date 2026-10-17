-- /platform/cash balances come from SQL (migration 20261012000493_admin_courier_cash_balances), not
-- from an app-side sum over a PostgREST response capped at 1000 rows. The view must equal
-- courier_cash_balance() for every courier, and stay admin-only like the ledger.
do $$
declare
  v_admin uuid; v_bad int; v_seen int; c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_cour uuid; b_coll numeric; b_off numeric; b_oth numeric; b_mov bigint; a_coll numeric; a_off numeric; a_oth numeric; a_mov bigint; a_bal numeric;
begin
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  select id into v_cour from public.couriers order by id limit 1;
  select coalesce(sum(amount_mdl) filter (where kind = 'collected'), 0), coalesce(sum(amount_mdl) filter (where kind = 'offload'), 0),
         coalesce(sum(amount_mdl) filter (where kind not in ('collected', 'offload')), 0), count(*)
    into b_coll, b_off, b_oth, b_mov from public.courier_cash_movements where courier_id = v_cour;
  -- 1200 extra ledger rows for one courier (more than max_rows): 600 x +10.05 collected, 600 x -10.00 offload = net +30 MDL
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_cour, case when g % 2 = 0 then 'collected' else 'offload' end,
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
  -- C3: every column of the view, not only the balance (round(), a dropped kind, a wrong count would all hide)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select collected_mdl, offloaded_mdl, other_mdl, movements, balance_mdl into a_coll, a_off, a_oth, a_mov, a_bal
    from public.admin_courier_cash_balances where courier_id = v_cour;
  reset role;
  if a_coll <> b_coll + 6030.00 or a_off <> b_off - 6000.00 or a_oth <> b_oth or a_mov <> b_mov + 1200 or a_bal <> b_coll + b_off + b_oth + 30.00 then
    raise exception 'FAIL 295.C3: view columns off — collected % (exp %), offloaded % (exp %), other % (exp %), movements % (exp %), balance % (exp %)',
      a_coll, b_coll + 6030.00, a_off, b_off - 6000.00, a_oth, b_oth, a_mov, b_mov + 1200, a_bal, b_coll + b_off + b_oth + 30.00;
  end if;
  raise notice 'PASS 295.C3: collected / offloaded / other / movements / balance exact (+6030.00 / -6000.00 / +0 / +1200 / +30.00)';
end $$;
