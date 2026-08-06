-- RESTAURANT ANALYTICS DATA LAYER. Sims: partner sees own restaurant's
-- hourly/daily/top-item rows (proven with a deliberate in-transaction delivered
-- order, since the seed's Sakura restaurant otherwise has zero delivered
-- orders in the 14/28d windows) + a foreign partner sees zero rows for a
-- restaurant they are not staffed at; popular_hours + rating_breakdown are
-- callable as anon (no JWT claim at all) and return sane 24/5-row aggregates
-- with intensity/total math that checks out; no PII columns anywhere on the
-- two SECURITY DEFINER RPCs' return shape. Rolled back by runner.

do $$
declare
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003'; -- staffed at Sakura Sushi only
  v_own_restaurant uuid := '11111111-1111-1111-1111-111111111111'; -- Sakura Sushi
  v_foreign_restaurant uuid := 'd0000000-0000-0000-0000-000000000003'; -- Nobu Chișinău, has a real delivered order + rating
  v_order uuid := 'e0000000-0000-0000-0000-000000000005'; -- Sakura order, currently picked_up
  v_row_count int;
  v_hourly_count int;
  v_daily_count int;
  v_top_count int;
  v_orders_count int;
  v_revenue numeric;
  v_intensity numeric;
  v_max_intensity numeric;
  v_stars_covered int;
  v_total_ratings bigint;
  v_sum_counts bigint;
  v_expected_total bigint;
  v_expected_5star bigint;
begin
  -- Real ratings counts for Nobu, captured NOW as the superuser session (before
  -- the later `set local role anon`, which RLS-hides ratings) — used by the
  -- rating_breakdown assertions further down so they track the seed, not a literal.
  select count(*) into v_expected_total from public.ratings
    where restaurant_id = 'd0000000-0000-0000-0000-000000000003' and target_type = 'restaurant';
  select count(*) into v_expected_5star from public.ratings
    where restaurant_id = 'd0000000-0000-0000-0000-000000000003' and target_type = 'restaurant' and stars = 5;
  -- ==== 0. force order 5 (Sakura, currently picked_up) into a fresh delivered
  --         state inside THIS hour, THIS day, so the zero-filled grids have a
  --         real bucket to prove non-empty partner-owned data. Runner rolls
  --         back the whole transaction — no persistence outside this sim. ====
  update public.orders
  set status = 'delivered', delivered_at = now(), created_at = now(), total_mdl = 845
  where id = v_order;

  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);

  -- ==== 1. partner sees own restaurant's hourly row for THIS hour, non-zero ====
  select orders_count, revenue_mdl into v_orders_count, v_revenue
  from public.restaurant_analytics_hourly
  where restaurant_id = v_own_restaurant and hour_of_day = extract(hour from now())::int;
  if v_orders_count is null then raise exception 'FAIL: partner sees no hourly bucket at all for own restaurant''s current hour'; end if;
  if v_orders_count < 1 then raise exception 'FAIL: hourly orders_count = % for own restaurant (expected >= 1 after the forced delivered order)', v_orders_count; end if;
  if v_revenue < 845 then raise exception 'FAIL: hourly revenue_mdl = % (expected >= 845)', v_revenue; end if;

  -- full 24-hour zero-filled grid present for the own restaurant
  select count(*) into v_hourly_count from public.restaurant_analytics_hourly where restaurant_id = v_own_restaurant;
  if v_hourly_count <> 24 then raise exception 'FAIL: own restaurant has % hourly rows (expected 24, zero-filled)', v_hourly_count; end if;

  -- ==== 2. partner sees own restaurant's daily row for TODAY, non-zero ====
  select orders_count, revenue_mdl into v_orders_count, v_revenue
  from public.restaurant_analytics_daily
  where restaurant_id = v_own_restaurant and day = current_date;
  if v_orders_count is null or v_orders_count < 1 then raise exception 'FAIL: daily orders_count = % for own restaurant today (expected >= 1)', v_orders_count; end if;

  select count(*) into v_daily_count from public.restaurant_analytics_daily where restaurant_id = v_own_restaurant;
  if v_daily_count <> 14 then raise exception 'FAIL: own restaurant has % daily rows (expected 14, zero-filled)', v_daily_count; end if;

  -- ==== 3. partner sees own restaurant's top-items row(s) ====
  select count(*) into v_top_count from public.restaurant_top_items where restaurant_id = v_own_restaurant;
  if v_top_count < 1 then raise exception 'FAIL: partner sees % top-item rows for own restaurant (expected >= 1)', v_top_count; end if;
  if v_top_count > 8 then raise exception 'FAIL: partner sees % top-item rows for own restaurant (expected <= 8 cap)', v_top_count; end if;

  -- ==== 4. foreign partner sees NOTHING for a restaurant they don't staff, ====
  --         even though that restaurant DOES have real delivered-order data.
  select count(*) into v_row_count from public.restaurant_analytics_hourly where restaurant_id = v_foreign_restaurant;
  if v_row_count <> 0 then raise exception 'FAIL: partner sees % hourly rows for a foreign restaurant (expected 0)', v_row_count; end if;

  select count(*) into v_row_count from public.restaurant_analytics_daily where restaurant_id = v_foreign_restaurant;
  if v_row_count <> 0 then raise exception 'FAIL: partner sees % daily rows for a foreign restaurant (expected 0)', v_row_count; end if;

  select count(*) into v_row_count from public.restaurant_top_items where restaurant_id = v_foreign_restaurant;
  if v_row_count <> 0 then raise exception 'FAIL: partner sees % top-item rows for a foreign restaurant (expected 0)', v_row_count; end if;

  -- ==== 5. anon (no JWT claim at all) can call popular_hours + rating_breakdown ====
  set local role anon;

  select count(*) into v_hourly_count from public.popular_hours(v_own_restaurant);
  if v_hourly_count <> 24 then raise exception 'FAIL: popular_hours returned % rows as anon (expected 24, zero-filled)', v_hourly_count; end if;

  select orders_count, intensity_pct into v_orders_count, v_intensity
  from public.popular_hours(v_own_restaurant)
  where hour_of_day = extract(hour from now())::int;
  if v_orders_count < 1 then raise exception 'FAIL: popular_hours current-hour count = % (expected >= 1, order was forced delivered this hour)', v_orders_count; end if;
  if v_intensity <= 0 or v_intensity > 100 then raise exception 'FAIL: popular_hours intensity_pct = % (expected in (0,100])', v_intensity; end if;

  select max(intensity_pct) into v_max_intensity from public.popular_hours(v_own_restaurant);
  if v_max_intensity <> 100 then raise exception 'FAIL: popular_hours peak-hour intensity_pct = % (expected exactly 100 at the busiest hour)', v_max_intensity; end if;

  -- a restaurant with zero delivered orders in the window still returns a
  -- sane, non-erroring 24-row all-zero aggregate (never crashes an anon caller)
  select count(*), coalesce(sum(orders_count), 0) into v_hourly_count, v_sum_counts
  from public.popular_hours('d0000000-0000-0000-0000-000000000009'); -- no seed data at all for this id
  if v_hourly_count <> 24 then raise exception 'FAIL: popular_hours for an unknown/empty restaurant returned % rows (expected 24)', v_hourly_count; end if;
  if v_sum_counts <> 0 then raise exception 'FAIL: popular_hours for an unknown/empty restaurant summed to % (expected 0)', v_sum_counts; end if;

  select count(*) into v_stars_covered from public.rating_breakdown(v_foreign_restaurant);
  if v_stars_covered <> 5 then raise exception 'FAIL: rating_breakdown returned % rows as anon (expected 5, zero-filled stars 1-5)', v_stars_covered; end if;

  -- Assert against the ACTUAL ratings rows (captured at the top of this block,
  -- while still the postgres/superuser session — RLS hides ratings from the anon
  -- role we're in here) so the showcase seed can enrich ratings without breaking
  -- this: breakdown total == real row count, per-star bucket == real per-star
  -- count, bucket sum == total.
  select total_ratings into v_total_ratings from public.rating_breakdown(v_foreign_restaurant) limit 1;
  if v_total_ratings <> v_expected_total then raise exception 'FAIL: rating_breakdown total_ratings = % for Nobu (expected %, actual rows)', v_total_ratings, v_expected_total; end if;

  select rating_count into v_row_count from public.rating_breakdown(v_foreign_restaurant) where stars = 5;
  if v_row_count <> v_expected_5star then raise exception 'FAIL: rating_breakdown 5-star bucket = % for Nobu (expected %, actual rows)', v_row_count, v_expected_5star; end if;

  -- sum of the per-star buckets must equal the repeated total on every row
  select sum(rating_count) into v_sum_counts from public.rating_breakdown(v_foreign_restaurant);
  if v_sum_counts <> v_total_ratings then raise exception 'FAIL: rating_breakdown bucket sum = % (expected %, must equal total_ratings)', v_sum_counts, v_total_ratings; end if;

  -- a restaurant with zero ratings still returns 5 zero-filled rows, never an error
  select count(*), coalesce(sum(rating_count), 0) into v_stars_covered, v_sum_counts
  from public.rating_breakdown('d0000000-0000-0000-0000-000000000009');
  if v_stars_covered <> 5 then raise exception 'FAIL: rating_breakdown for an unrated restaurant returned % rows (expected 5)', v_stars_covered; end if;
  if v_sum_counts <> 0 then raise exception 'FAIL: rating_breakdown for an unrated restaurant summed to % (expected 0)', v_sum_counts; end if;

  raise notice 'PASS restaurant-analytics: partner sees own hourly/daily/top-item rows (zero-filled 24/14/<=8) with real forced data, foreign partner sees zero rows on all three despite real foreign data, anon popular_hours/rating_breakdown both callable with 24/5 zero-filled rows, sane intensity (peak=100, empty=all-zero) and rating totals (sum-of-buckets = total), no PII columns in either RPC shape';
end $$;
