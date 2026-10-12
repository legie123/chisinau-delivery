-- Admin team management. Roles changed only through SQL; now admin_set_platform_admin grants or
-- revokes platform_admin by email. Guards: caller is platform_admin; reason mandatory (stored in
-- admin_audit_log as _motiv via app.audit_reason); never on yourself (no lockout); only a plain
-- customer can be promoted and a revoked admin goes back to customer — couriers and partners carry
-- couriers / restaurant_staff rows and get their role through onboarding (CLAUDE.md rule 5).
-- profiles_guard_role lets this through because the function runs as its owner (security definer).

create or replace function public.admin_set_platform_admin(p_email text, p_grant boolean, p_reason text)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_target uuid;
  v_role text;
begin
  if not public.has_role('platform_admin') then raise exception 'Doar un administrator poate să acorde sau să retragă acest drept.'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'Scrie motivul (minim 5 caractere) — rămâne în audit.'; end if;
  select u.id into v_target from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_target is null then raise exception 'Nu există niciun cont cu acest email.'; end if;
  if v_target = auth.uid() then raise exception 'Nu îți poți schimba singur rolul.'; end if;
  select role into v_role from public.profiles where id = v_target for update;
  if p_grant then
    if v_role is distinct from 'customer' then
      raise exception 'Doar un cont de client poate deveni administrator; acesta are rolul % și își primește rolul prin înscriere.', coalesce(v_role, 'necunoscut');
    end if;
  elsif v_role is distinct from 'platform_admin' then
    raise exception 'Contul acesta nu e administrator, deci nu ai ce să retragi.';
  end if;
  perform set_config('app.audit_reason', btrim(p_reason), true);
  update public.profiles set role = case when p_grant then 'platform_admin' else 'customer' end where id = v_target;
  perform set_config('app.audit_reason', '', true);
end $$;
revoke all on function public.admin_set_platform_admin(text, boolean, text) from public, anon;
grant execute on function public.admin_set_platform_admin(text, boolean, text) to authenticated;
