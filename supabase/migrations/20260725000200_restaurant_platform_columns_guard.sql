-- ============================================================================
-- WAVE 2 — SECURITY/AUTHZ  (audit #8, HIGH)
--
-- restaurants_staff_write is a row-level UPDATE policy (has_restaurant_access) with
-- no column scoping, and `authenticated` holds table-level UPDATE. So a restaurant
-- partner could `.update({ is_active: true })` their own row and silently overturn a
-- platform suspension (is_active is the moderation flag) — or rewrite their slug
-- (identity/routing). RLS can't restrict columns, so mirror the existing
-- guard_rating_columns trigger pattern: revert platform-controlled columns on any
-- write that is neither the table owner (a SECURITY DEFINER RPC) nor a platform_admin.
--
-- accepting_orders / delivery_fee / hours / storefront fields stay partner-editable —
-- only is_active and slug are locked to the platform.
-- ============================================================================
create or replace function public.guard_restaurant_platform_columns()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare v_privileged boolean;
begin
  -- INVOKER context: current_user is the real writer (postgres when a definer RPC
  -- runs as owner; authenticated on a direct client UPDATE).
  select coalesce(bool_or(rolbypassrls or rolsuper), false) into v_privileged
  from pg_roles where rolname = current_user;
  if v_privileged or public.has_role('platform_admin') then
    return new; -- owner/definer or a platform admin may moderate these fields
  end if;
  new.is_active := old.is_active;
  new.slug := old.slug;
  return new;
end;
$$;

drop trigger if exists restaurants_guard_platform_cols on public.restaurants;
create trigger restaurants_guard_platform_cols
  before update on public.restaurants
  for each row execute function public.guard_restaurant_platform_columns();
