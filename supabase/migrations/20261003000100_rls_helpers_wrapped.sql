-- RLS helpers as initPlans: has_role('x') / has_any_role(ARRAY['x']) / current_courier_id() written
-- bare in a policy run once PER ROW (each is a STABLE SECURITY DEFINER SQL fn: not inlinable, one
-- profiles/couriers lookup per call). Wrapped as (SELECT ...) they become an InitPlan, run once per
-- statement — the same trick 20260727001600_rls_fast_path applied to auth.uid() only.
--
-- Generated FROM the live catalog, not hand-typed: each public policy whose USING / WITH CHECK
-- contains a constant-argument helper call gets ALTER POLICY with the regex-wrapped text. ALTER
-- POLICY touches only the expressions, so name / table / cmd / roles / permissive stay identical
-- by construction.
--
-- Deliberately NOT wrapped: has_restaurant_access(<column>) — its argument is the row's column, so
-- (SELECT has_restaurant_access(restaurant_id)) is a correlated SubPlan, still once per row (no
-- gain). Those calls stay as they are.
--
-- Guards (any failure aborts the migration):
--   1. the number of rewritten policies equals the count measured on 2026-10-03 (38 of the 53
--      policies that call any helper; the other 15 call only has_restaurant_access(<column>));
--   2. after the rewrite no public policy contains an unwrapped constant-argument helper call;
--   3. per policy, stripping the new "( SELECT f(..) AS f)" wrappers gives back the OLD text byte
--      for byte — proof that the wrap is the only change;
--   4. total public policy count unchanged.

do $mig$
declare
  c_re  constant text :=
    '(?<!SELECT )\m(has_role\(''[a-z_]+''::text\)|has_any_role\(ARRAY\[''[a-z_]+''::text(, ''[a-z_]+''::text)*\]\)|current_courier_id\(\))';
  c_unwrap constant text :=
    '\( SELECT (has_role\(''[a-z_]+''::text\)|has_any_role\(ARRAY\[''[a-z_]+''::text(, ''[a-z_]+''::text)*\]\)|current_courier_id\(\)) AS [a-z_]+\)';
  c_expected constant int := 38;
  r record;
  v_total int;
  v_n int;
begin
  -- deparse and re-parse under one fixed path, so the text round-trips exactly
  perform set_config('search_path', 'public', true);

  select count(*) into v_total from pg_policies where schemaname = 'public';

  -- Scoped to THIS project's tables (hard rule 7: the shared remote also holds dormant Trade-AI
  -- tables; a stray helper call there must neither be rewritten nor trip the count guard).
  create temp table _rls_wrap_before on commit drop as
    select p.tablename, p.policyname, p.qual, p.with_check
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename not like 'poly%' and p.tablename not like 'polymarket%'
      and p.tablename not like 'gladiator%' and p.tablename not in ('equity_history', 'syndicate_audits')
      and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ c_re;

  select count(*) into v_n from _rls_wrap_before;
  if v_n <> c_expected then
    raise exception 'rls_helpers_wrapped: % policies to rewrite, expected % — catalog drifted, regenerate', v_n, c_expected;
  end if;

  for r in select * from _rls_wrap_before loop
    execute format('alter policy %I on public.%I', r.policyname, r.tablename)
      || coalesce(' using (' || regexp_replace(r.qual, c_re, '(SELECT \1)', 'g') || ')', '')
      || coalesce(' with check (' || regexp_replace(r.with_check, c_re, '(SELECT \1)', 'g') || ')', '');
  end loop;

  select count(*) into v_n from pg_policies p
  where p.schemaname = 'public'
    and p.tablename not like 'poly%' and p.tablename not like 'polymarket%'
    and p.tablename not like 'gladiator%' and p.tablename not in ('equity_history', 'syndicate_audits')
    and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ c_re;
  if v_n <> 0 then
    raise exception 'rls_helpers_wrapped: % policies still hold an unwrapped helper call', v_n;
  end if;

  select count(*) into v_n
  from _rls_wrap_before b
  join pg_policies p on p.schemaname = 'public' and p.tablename = b.tablename and p.policyname = b.policyname
  where regexp_replace(coalesce(p.qual, ''), c_unwrap, '\1', 'g') is distinct from coalesce(b.qual, '')
     or regexp_replace(coalesce(p.with_check, ''), c_unwrap, '\1', 'g') is distinct from coalesce(b.with_check, '');
  if v_n <> 0 then
    raise exception 'rls_helpers_wrapped: % policies changed beyond the wrap', v_n;
  end if;

  if (select count(*) from pg_policies where schemaname = 'public') <> v_total then
    raise exception 'rls_helpers_wrapped: public policy count changed';
  end if;
end
$mig$;
