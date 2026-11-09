-- Menu editor parity (2/4): `is_age_restricted` (alcohol / tobacco, shown as "18+") and free
-- `tags` (vegan, picant, fără gluten…; max 10, parsed by src/lib/kitchen/menuTags.ts).
-- Sim 216. Rollback: supabase/rollbacks/20261013000313_*.down.sql.
alter table public.menu_items
  add column is_age_restricted boolean not null default false,
  add column tags text[] not null default '{}',
  add constraint menu_items_tags_max_check
    check (array_length(tags, 1) is null or array_length(tags, 1) <= 10);
