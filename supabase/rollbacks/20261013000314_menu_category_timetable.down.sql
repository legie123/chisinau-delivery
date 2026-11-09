drop function if exists public.menu_category_available_at(uuid, timestamptz);
alter table public.menu_categories
  drop constraint if exists menu_categories_timetable_check,
  drop column if exists available_from,
  drop column if exists available_until;
