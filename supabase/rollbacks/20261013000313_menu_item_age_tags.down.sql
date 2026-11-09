alter table public.menu_items
  drop constraint if exists menu_items_tags_max_check,
  drop column if exists is_age_restricted,
  drop column if exists tags;
