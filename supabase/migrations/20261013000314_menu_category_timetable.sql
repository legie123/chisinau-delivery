-- Menu editor parity (3/4): a category can be served only in a daily window
-- (mic dejun 07:00–11:00, meniu de noapte 22:00–02:00). Both columns null = always.
-- menu_category_available_at(category, at) evaluates the window in Europe/Chisinau local time,
-- overnight (from > until) wraps past midnight; `until` is exclusive. Pure helper, security
-- invoker (menu_categories is public-read); not for anon — the storefront gate is CLIENT's call.
-- Sim 217. Rollback: supabase/rollbacks/20261013000314_*.down.sql.
alter table public.menu_categories
  add column available_from time,
  add column available_until time,
  add constraint menu_categories_timetable_check
    check ((available_from is null) = (available_until is null));

create or replace function public.menu_category_available_at(p_category uuid, p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when c.available_from is null then true
    when c.available_from <= c.available_until
      then t.lt >= c.available_from and t.lt < c.available_until
    else t.lt >= c.available_from or t.lt < c.available_until
  end
  from public.menu_categories c,
       lateral (select (p_at at time zone 'Europe/Chisinau')::time as lt) t
  where c.id = p_category;
$$;

revoke execute on function public.menu_category_available_at(uuid, timestamptz) from public, anon;
grant execute on function public.menu_category_available_at(uuid, timestamptz) to authenticated, service_role;
