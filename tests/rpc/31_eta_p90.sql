-- DB hygiene order 9 — get_prep_estimates gains p90_prep_minutes (additive
-- column, same fallback ladder). Rolled back by runner.

do $$
declare
  v_hour int := date_part('hour', now() at time zone 'Europe/Chisinau')::int;
  v_other_hour_1 int := (v_hour + 1) % 24;
  v_other_hour_2 int := (v_hour + 2) % 24;
  v_rest_hourly uuid;
  v_rest_overall uuid;
  v_rest_static uuid;
  v_static_avg int;
  r record;
  v_expected_avg numeric;
  v_expected_p90 numeric;
begin
  select id into v_rest_hourly from public.restaurants order by name limit 1 offset 0;
  select id into v_rest_overall from public.restaurants order by name limit 1 offset 1;
  select id, avg_prep_minutes into v_rest_static, v_static_avg from public.restaurants order by name limit 1 offset 2;

  -- clean slate for all three test restaurants so leftover seed data can't skew a tier
  delete from public.restaurant_prep_stats where restaurant_id in (v_rest_hourly, v_rest_overall, v_rest_static);

  -- ===== hourly tier: a current-hour bucket with enough samples wins outright =====
  insert into public.restaurant_prep_stats (restaurant_id, hour_of_day, sample_count, avg_prep_minutes, p90_prep_minutes)
  values (v_rest_hourly, v_hour, 20, 25.0, 45.0);

  select * into r from public.get_prep_estimates(array[v_rest_hourly]) limit 1;
  if r.source <> 'hourly' then raise exception 'FAIL hourly: expected source=hourly, got %', r.source; end if;
  if r.prep_minutes <> 25 then raise exception 'FAIL hourly: expected prep_minutes=25, got %', r.prep_minutes; end if;
  if r.p90_prep_minutes <> 45.0 then raise exception 'FAIL hourly: expected p90=45.0, got %', r.p90_prep_minutes; end if;
  raise notice 'PASS hourly: prep_minutes=%, p90_prep_minutes=%', r.prep_minutes, r.p90_prep_minutes;

  -- ===== overall tier: no current-hour bucket, but other-hour buckets sum to >=5 =====
  insert into public.restaurant_prep_stats (restaurant_id, hour_of_day, sample_count, avg_prep_minutes, p90_prep_minutes)
  values
    (v_rest_overall, v_other_hour_1, 3, 20.0, 35.0),
    (v_rest_overall, v_other_hour_2, 4, 30.0, 50.0);
  -- weighted-mean expectation, matching get_prep_estimates' own ov.avg_all/ov.p90_all formula
  select (sum(avg_prep_minutes * sample_count) / sum(sample_count)),
         (sum(p90_prep_minutes * sample_count) / sum(sample_count))
    into v_expected_avg, v_expected_p90
  from public.restaurant_prep_stats where restaurant_id = v_rest_overall;

  select * into r from public.get_prep_estimates(array[v_rest_overall]) limit 1;
  if r.source <> 'overall' then raise exception 'FAIL overall: expected source=overall, got %', r.source; end if;
  if r.prep_minutes <> v_expected_avg::int then
    raise exception 'FAIL overall: expected prep_minutes=%, got %', v_expected_avg::int, r.prep_minutes;
  end if;
  if r.p90_prep_minutes <> v_expected_p90 then
    raise exception 'FAIL overall: expected p90=%, got %', v_expected_p90, r.p90_prep_minutes;
  end if;
  raise notice 'PASS overall: prep_minutes=%, p90_prep_minutes=% (weighted across % buckets)', r.prep_minutes, r.p90_prep_minutes, 2;

  -- ===== static tier: zero stats rows -> static column, p90 null-safe =====
  select * into r from public.get_prep_estimates(array[v_rest_static]) limit 1;
  if r.source <> 'static' then raise exception 'FAIL static: expected source=static, got %', r.source; end if;
  if r.prep_minutes <> v_static_avg then
    raise exception 'FAIL static: expected prep_minutes=% (restaurants.avg_prep_minutes), got %', v_static_avg, r.prep_minutes;
  end if;
  if r.p90_prep_minutes is not null then
    raise exception 'FAIL static: expected p90_prep_minutes null, got %', r.p90_prep_minutes;
  end if;
  raise notice 'PASS static: falls back to restaurants.avg_prep_minutes=%, p90 stays null', r.prep_minutes;
end $$;

-- ===== formatPrepRange fallback ladder can't be exercised in SQL (it's the TS
-- helper in src/lib/orders/eta.ts) — this file only proves the RPC contract it
-- consumes: p90_prep_minutes present when stats exist, null when they don't.
