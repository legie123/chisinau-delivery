alter table public.menu_categories
  drop column if exists name_ru,
  drop column if exists name_en;
