-- Money config cannot be backdated (migration 20261012000491_config_no_backdating).
-- Payouts read the commission of the pricing_config version in effect at each order's
-- delivered_at (pricing_config_at). set_pricing_config accepted any p_effective_from, so an admin
-- (or a typo in a date field) could insert a version dated last month and silently re-price every
-- delivered-but-unpaid order since then. Same for the courier tariff, the cash policy and the
-- dispatch scoring config. After: a new version may start at the earliest 5 minutes in the past
-- (clock skew); the future is fine; history stays as it was.
do $$
declare
  v_admin uuid; v_err text; v_before numeric; v_after numeric; v_at timestamptz := now() - interval '3 days';
begin
  select id into v_admin from public.profiles where role = 'platform_admin' limit 1;
  select courier_commission_pct into v_before from public.pricing_config_at(v_at);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ===== B1: a pricing version dated 10 days ago is refused, history unchanged =====
  v_err := null;
  begin perform public.set_pricing_config(55, 55, now() - interval '10 days', 'sim 292 backdated');
  exception when others then v_err := sqlerrm; end;
  reset role;
  select courier_commission_pct into v_after from public.pricing_config_at(v_at);
  if v_err is null or v_after is distinct from v_before then
    raise exception 'FAIL 292.B1: backdated pricing accepted (commission at % went % -> %)', v_at, v_before, v_after;
  end if;
  raise notice 'PASS 292.B1: backdated pricing refused (%), commission 3 days ago still %', v_err, v_before;

  -- ===== B2: courier tariff, cash policy and dispatch scoring are guarded the same way =====
  set local role authenticated;
  v_err := null;
  begin perform public.set_courier_tariff(1, 1, 1, 3, now() - interval '10 days', 'sim 292');
  exception when others then v_err := sqlerrm; end;
  if v_err is null then reset role; raise exception 'FAIL 292.B2: backdated courier tariff accepted'; end if;
  v_err := null;
  begin perform public.set_cash_policy(1500, 1000, 'sim 292 depunere', now() - interval '10 days', 'sim 292');
  exception when others then v_err := sqlerrm; end;
  if v_err is null then reset role; raise exception 'FAIL 292.B2: backdated cash policy accepted'; end if;
  v_err := null;
  begin perform public.set_dispatch_scoring_config(1, 1, 1, now() - interval '10 days', 'sim 292');
  exception when others then v_err := sqlerrm; end;
  if v_err is null then reset role; raise exception 'FAIL 292.B2: backdated dispatch scoring accepted'; end if;
  raise notice 'PASS 292.B2: backdated tariff / cash policy / dispatch scoring refused';

  -- ===== B3: a change starting now or in the future still works =====
  perform public.set_pricing_config(15, 20, now() + interval '1 day', 'sim 292 viitor');
  perform public.set_courier_tariff(30, 6, 1.5, 3, now(), 'sim 292 acum');
  reset role;
  raise notice 'PASS 292.B3: future/now versions accepted';
end $$;
