-- 76: one config version per instant (migration 20261004000400). Two pricing versions at the
-- same effective_from made the payout and the courier app pick different commissions.
do $$
declare
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  v_at timestamptz := date_trunc('second', now()) + interval '30 days';
  v_blocked boolean := false;
  v_pct numeric;
  v_missing text;
begin
  select string_agg(t, ', ') into v_missing
  from unnest(array['pricing_config', 'cash_policy', 'courier_tariff_config', 'dispatch_scoring_config']) as t
  where not exists (
    select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = ('public.' || t)::regclass and i.indisunique and i.indnatts = 1 and a.attname = 'effective_from');
  if v_missing is not null then raise exception 'FAIL 76.1: no unique effective_from on: %', v_missing; end if;

  perform set_config('search_path', 'public', true);
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_pricing_config(33.33, 20, v_at, 'sim 76: typo');
  begin
    perform public.set_pricing_config(7.77, 20, v_at, 'sim 76: same instant');
  exception when unique_violation then v_blocked := true;
  end;
  perform public.set_pricing_config(7.77, 20, v_at + interval '1 second', 'sim 76: correction');
  reset role;
  if not v_blocked then raise exception 'FAIL 76.2: a second pricing version at the same instant was accepted'; end if;

  select courier_commission_pct into v_pct from public.pricing_config_at(v_at + interval '1 day');
  if v_pct <> 7.77 then raise exception 'FAIL 76.3: the correction is not the version in effect (got %)', v_pct; end if;
  raise notice 'PASS 76: one version per instant on all 4 config tables; a correction at a later instant wins';
end $$;
