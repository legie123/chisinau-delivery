-- RLS fast-path (20260727001600). Two mechanical rewrites applied to EVERY
-- policy in the live catalog: (1) bare auth.uid() -> (select auth.uid())
-- (initPlan once-per-statement instead of once-per-row); (2) explicit
-- TO authenticated (or TO authenticated, anon on the genuinely-public
-- restaurant/menu browse surface). Proves both the perf mechanism and that
-- per-role RLS semantics are unchanged. Rolled back by the runner.
--
-- NB: the runner wraps every file in BEGIN;...ROLLBACK; and connects as the
-- postgres superuser (BYPASSRLS) — the earlier 28 files simulate auth via
-- request.jwt.claims alone, which is enough for SECURITY DEFINER RPC checks
-- but does NOT exercise table-level RLS (a superuser session ignores it).
-- This file additionally does `set local role` to actually become a
-- non-bypassrls role for the parts that probe raw table reads.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111'; -- Sakura Sushi
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003'; -- staff of v_rest
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier_user uuid := 'c0000000-0000-0000-0000-000000000007';
  v_courier uuid;
  v_item uuid; v_addr uuid;
  v_oid uuid; v_offer uuid;
  v_foreign_order uuid := 'e0000000-0000-0000-0000-000000000002'; -- customer b...002, restaurant d...004, status accepted, no courier
  v_plan text; v_line text; v_n bigint;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;

  -- Demo-urile live mută comanda seed în alte stări (ready_for_pickup e vizibil
  -- curierilor prin design, pre-dispatch) — sim-ul își forțează singur premisa
  -- „accepted, fără curier" pe care se sprijină aserțiunile de leak (rollback).
  update public.orders set status = 'accepted', courier_id = null
  where id = v_foreign_order;

  ---------------------------------------------------------------------------
  -- (a) anon: zero rows AND zero execution of the policy qual.
  -- roles={authenticated} on orders/profiles/couriers means Postgres rewrites
  -- the USING clause to a flat `false` for any other role — the planner
  -- proves this with "One-Time Filter: false" and no scan/subplan at all,
  -- i.e. has_role()/auth.uid()/current_courier_id() are never invoked.
  ---------------------------------------------------------------------------
  set local role anon;

  v_plan := '';
  for v_line in execute 'explain (costs off) select 1 from public.orders' loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  if v_plan !~ 'One-Time Filter: false' then
    raise exception 'FAIL: anon plan for orders did not short-circuit (qual would be evaluated): %', v_plan;
  end if;

  v_plan := '';
  for v_line in execute 'explain (costs off) select 1 from public.profiles' loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  if v_plan !~ 'One-Time Filter: false' then
    raise exception 'FAIL: anon plan for profiles did not short-circuit: %', v_plan;
  end if;

  select count(*) into v_n from public.orders;
  if v_n <> 0 then raise exception 'FAIL: anon sees % rows in orders (expected 0)', v_n; end if;

  select count(*) into v_n from public.profiles;
  if v_n <> 0 then raise exception 'FAIL: anon sees % rows in profiles (expected 0)', v_n; end if;

  select count(*) into v_n from public.couriers;
  if v_n <> 0 then raise exception 'FAIL: anon sees % rows in couriers (expected 0)', v_n; end if;

  -- anon browse surface must still work (restaurants/menu are TO authenticated, anon)
  select count(*) into v_n from public.restaurants where is_active;
  if v_n < 1 then raise exception 'FAIL: anon cannot browse active restaurants (got %)', v_n; end if;

  select count(*) into v_n from public.menu_items mi
    join public.restaurants r on r.id = mi.restaurant_id
    where r.id = v_rest and mi.is_available and r.is_active;
  if v_n < 1 then raise exception 'FAIL: anon cannot browse menu_items for an active restaurant (got %)', v_n; end if;

  reset role;
  raise notice 'PASS rls-fast-path (a): anon short-circuits (no qual execution) on protected tables, zero rows, browse surface intact';

  ---------------------------------------------------------------------------
  -- Fixture: one fresh order, own restaurant/customer/courier, to probe with.
  ---------------------------------------------------------------------------
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;  -- deterministic: priciest modifier-free item (heap order is not stable)
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  -- isolate: only v_courier is a dispatch candidate (mirrors test 27/28)
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  update public.couriers set status = 'offline' where id <> v_courier;
  update public.couriers set status = 'online', is_active = true where id = v_courier;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);
  select id into v_offer from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offer is null then raise exception 'FAIL: fixture setup — no dispatch offer fired for v_oid'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform public.accept_dispatch_offer(v_offer);

  ---------------------------------------------------------------------------
  -- (b) per-role probes, RLS actually enforced (set local role authenticated).
  ---------------------------------------------------------------------------
  set local role authenticated;

  -- customer: sees own order, not the foreign one
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  perform 1 from public.orders where id = v_oid;
  if not found then raise exception 'FAIL: customer cannot see own order under RLS'; end if;
  perform 1 from public.orders where id = v_foreign_order;
  if found then raise exception 'FAIL: customer sees a foreign order (RLS leak)'; end if;

  -- courier: sees the assigned order, not the foreign (unassigned, non-ready) order
  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user,'role','authenticated')::text, true);
  perform 1 from public.orders where id = v_oid;
  if not found then raise exception 'FAIL: assigned courier cannot see own order under RLS'; end if;
  perform 1 from public.orders where id = v_foreign_order;
  if found then raise exception 'FAIL: courier sees a foreign (unassigned, non-ready) order (RLS leak)'; end if;

  -- partner: sees own-restaurant order, not the foreign-restaurant order
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform 1 from public.orders where id = v_oid;
  if not found then raise exception 'FAIL: restaurant partner cannot see own-restaurant order under RLS'; end if;
  perform 1 from public.orders where id = v_foreign_order;
  if found then raise exception 'FAIL: partner sees a foreign-restaurant order (RLS leak)'; end if;

  -- admin: sees both
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform 1 from public.orders where id = v_oid;
  if not found then raise exception 'FAIL: admin cannot see the order under RLS'; end if;
  perform 1 from public.orders where id = v_foreign_order;
  if not found then raise exception 'FAIL: admin cannot see the foreign order under RLS (admin must see all)'; end if;

  reset role;
  raise notice 'PASS rls-fast-path (b): customer/courier/partner scoped correctly, admin sees all — semantics unchanged post-rewrite';
end $$;
