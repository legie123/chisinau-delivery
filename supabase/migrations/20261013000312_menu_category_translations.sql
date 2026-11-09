-- Menu editor parity (1/4): category names in RU / EN, optional. The partner edits them inline
-- from /restaurant/menu (updateCategory); the storefront keeps reading `name` (RO) until the
-- customer app picks a locale. Sim 215. Rollback: supabase/rollbacks/20261013000312_*.down.sql.
alter table public.menu_categories
  add column name_ru text,
  add column name_en text;
