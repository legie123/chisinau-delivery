-- Menu item 18+ flag + tags (migration 20261013000313_menu_item_age_tags):
-- menu_items.is_age_restricted (default false) and tags text[] (default '{}', max 10).
-- Fails before the migration: column does not exist. Rolled back by runner.
do $$
declare
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_id uuid; v_age boolean; v_tags text[]; v_err text;
begin
  insert into public.menu_items (restaurant_id, name, price_mdl, is_available, is_age_restricted, tags)
  values (c_rest, 'Sim 216 Vin roșu', 120, false, true, array['vegan','picant']) returning id into v_id;

  select is_age_restricted, tags into v_age, v_tags from public.menu_items where id = v_id;
  if not v_age or v_tags <> array['vegan','picant'] then raise exception 'FAIL 216.1: age/tags not stored (% / %)', v_age, v_tags; end if;
  raise notice 'PASS 216.1: is_age_restricted + tags stored';

  -- defaults: not restricted, empty tags
  insert into public.menu_items (restaurant_id, name, price_mdl, is_available)
  values (c_rest, 'Sim 216 Supă', 50, false) returning id into v_id;
  select is_age_restricted, tags into v_age, v_tags from public.menu_items where id = v_id;
  if v_age or v_tags <> '{}'::text[] then raise exception 'FAIL 216.2: defaults wrong (% / %)', v_age, v_tags; end if;
  raise notice 'PASS 216.2: defaults false / {}';

  -- 11 tags → check constraint
  v_err := null;
  begin
    update public.menu_items set tags = array['a','b','c','d','e','f','g','h','i','j','k'] where id = v_id;
  exception when check_violation then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL 216.3: 11 tags accepted'; end if;
  raise notice 'PASS 216.3: >10 tags refused (%)', v_err;
end $$;
