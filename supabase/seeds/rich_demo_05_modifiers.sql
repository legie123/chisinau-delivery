-- Menu modifiers demo — option groups + options on a few Sakura items so the
-- customization modal + place_order validation are demoable/testable. Keyed by
-- (restaurant slug, item name) so it survives a fresh db reset (item ids are random).
do $$
declare v_item uuid; v_grp uuid;
begin
  -- California Roll — required sauce (pick 1) + optional extras (pick up to 3)
  select mi.id into v_item from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
   where r.slug = 'sakura-sushi' and mi.name = 'California Roll' limit 1;
  if v_item is not null then
    insert into public.menu_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
    values (v_item, 'Sos', true, 1, 1, 1) returning id into v_grp;
    insert into public.menu_options (group_id, name, price_delta_mdl, sort_order) values
      (v_grp, 'Soia clasică', 0, 1), (v_grp, 'Teriyaki', 10, 2), (v_grp, 'Unagi', 15, 3);

    insert into public.menu_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
    values (v_item, 'Extra', false, 0, 3, 2) returning id into v_grp;
    insert into public.menu_options (group_id, name, price_delta_mdl, sort_order) values
      (v_grp, 'Wasabi extra', 5, 1), (v_grp, 'Ghimbir extra', 5, 2), (v_grp, 'Tempura crunch', 15, 3);
  end if;

  -- Supă Miso — required size
  select mi.id into v_item from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
   where r.slug = 'sakura-sushi' and mi.name = 'Supă Miso' limit 1;
  if v_item is not null then
    insert into public.menu_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
    values (v_item, 'Mărime', true, 1, 1, 1) returning id into v_grp;
    insert into public.menu_options (group_id, name, price_delta_mdl, sort_order) values
      (v_grp, 'Mică', 0, 1), (v_grp, 'Mare', 25, 2);
  end if;
end $$;
