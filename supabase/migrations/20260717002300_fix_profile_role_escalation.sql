-- CRITICAL fix (adversarial security review, 2026-07-17).
-- profiles_update_own (migration 000000) is column-BLIND: USING/WITH CHECK only pin
-- the ROW (id = auth.uid()), never which COLUMNS change. Combined with authenticated
-- holding table-level UPDATE on profiles (Supabase platform default, made explicit by
-- grants_parity), ANY authenticated user could `PATCH /rest/v1/profiles?id=eq.<self>
-- {"role":"platform_admin"}` and self-promote to full platform admin — complete
-- takeover from a free customer account. This hole exists on the shared remote too.
--
-- Two layers: (1) column-scoped grant so the role write is denied at the privilege
-- layer; (2) a role-revert trigger (immune to any future re-grant), mirroring
-- guard_rating_columns. Legitimate role assignment happens at profile CREATION
-- (handle_new_customer_signup / the service-role admin invite), never via a client UPDATE.

-- Layer 1: authenticated may self-edit only full_name/phone, never role.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- Layer 2: revert any role change unless the writer bypasses RLS (postgres definer
-- paths / service_role admin tooling). A client role can never move it.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_privileged boolean;
begin
  if new.role is distinct from old.role then
    select coalesce(bool_or(rolbypassrls or rolsuper), false) into v_privileged
    from pg_roles where rolname = current_user;
    if not v_privileged then
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();
