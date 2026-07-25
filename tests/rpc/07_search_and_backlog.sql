-- Wave 9 backlog sims (search coverage #14, onboarding default hours #11). BEGIN/ROLLBACK.

-- ===== #14: search_menu_items — matches, RLS/visibility, wildcard safety =====
do $$
declare v_rest uuid; v_hidden_rest uuid; v_hits int; v_cat_only int; v_inactive int;
begin
  -- baseline: a common dish token returns results
  select count(*) into v_hits from public.search_menu_items('roll');
  if v_hits = 0 then raise exception 'FAIL #14: baseline dish search empty'; end if;

  -- catering-only items must NOT appear in the standard dish search
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.menu_items (restaurant_id, name, price_mdl, is_available, is_catering_only)
  values (v_rest, 'Platou Catering ZZQ', 999, true, true);
  select count(*) into v_cat_only from public.search_menu_items('ZZQ');
  if v_cat_only <> 0 then raise exception 'FAIL #14: catering-only item leaked into dish search'; end if;

  -- items of an INACTIVE restaurant must not appear
  insert into public.restaurants (slug, name, cuisine_type, address, phone, is_active)
  values ('hidden-zzq', 'Hidden ZZQ', 'other', 'x', 'x', false) returning id into v_hidden_rest;
  insert into public.menu_items (restaurant_id, name, price_mdl, is_available, is_catering_only)
  values (v_hidden_rest, 'Burger ZZQ Secret', 50, true, false);
  select count(*) into v_inactive from public.search_menu_items('ZZQ Secret');
  if v_inactive <> 0 then raise exception 'FAIL #14: inactive-restaurant item leaked'; end if;

  -- wildcard is literal (regression guard vs #33)
  if (select count(*) from public.search_menu_items('%')) <> 0 then raise exception 'FAIL #14: %% not escaped'; end if;
  raise notice 'PASS #14: dish search returns hits, hides catering-only + inactive, escapes wildcards';
end $$;

-- ===== #11: an onboarding-approved restaurant gets default hours (orderable once active) =====
do $$
declare v_app uuid; v_rid uuid; v_hours int; v_open boolean;
begin
  insert into public.onboarding_applications (user_id, applicant_type, status, full_name, phone, details)
  values ('a0000000-0000-0000-0000-000000000001', 'restaurant', 'pending', 'Noul Local', '+37360000123',
          jsonb_build_object('name', 'Noul Local ZZ', 'cuisine_type', 'other', 'address', 'Str. Nouă 1'))
  returning id into v_app;
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  perform public.review_onboarding_application(v_app, true, 'ok');

  select id into v_rid from public.restaurants where name = 'Noul Local ZZ';
  select count(*) into v_hours from public.restaurant_hours where restaurant_id = v_rid;
  if v_hours <> 7 then raise exception 'FAIL #11: approved restaurant has % hours rows (expected 7)', v_hours; end if;
  -- once activated, it reads open at noon (default 10-22)
  update public.restaurants set is_active = true, accepting_orders = true where id = v_rid;
  select public.restaurant_open_at(v_rid, (current_date::timestamp + time '12:00') at time zone 'Europe/Chisinau') into v_open;
  if not v_open then raise exception 'FAIL #11: activated restaurant reads closed at noon despite default hours'; end if;
  raise notice 'PASS #11: onboarding-approved restaurant gets 7 default-hours rows and is orderable when active';
end $$;
