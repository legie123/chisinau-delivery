-- Menu category translations (migration 20261013000312_menu_category_translations):
-- menu_categories.name_ru / name_en, optional, written by the partner from the inline
-- category editor. Fails before the migration: column does not exist. Rolled back by runner.
do $$
declare
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_id uuid; v_ru text; v_en text;
begin
  insert into public.menu_categories (restaurant_id, name, name_ru, name_en, sort_order)
  values (c_rest, 'Sim 215 Supe', 'Супы', 'Soups', 999) returning id into v_id;

  select name_ru, name_en into v_ru, v_en from public.menu_categories where id = v_id;
  if v_ru <> 'Супы' or v_en <> 'Soups' then raise exception 'FAIL 215.1: translations not stored (% / %)', v_ru, v_en; end if;
  raise notice 'PASS 215.1: name_ru/name_en stored and read back';

  -- translations are optional: a category without them is still valid
  update public.menu_categories set name_ru = null, name_en = null where id = v_id;
  select name_ru, name_en into v_ru, v_en from public.menu_categories where id = v_id;
  if v_ru is not null or v_en is not null then raise exception 'FAIL 215.2: null translations not accepted'; end if;
  raise notice 'PASS 215.2: translations nullable';
end $$;
