-- Admin team management. Roles changed only through SQL; now admin_set_platform_admin grants or
-- revokes platform_admin by email. Guards: caller is platform_admin (checked BEFORE the lock, so a
-- stranger never queues on the admin rows, then re-checked under it); reason mandatory (stored in
-- admin_audit_log as _motiv via app.audit_reason); never on yourself (no lockout); only a plain
-- customer can be promoted and a revoked admin goes back to customer — couriers and partners carry
-- couriers / restaurant_staff rows and get their role through onboarding (CLAUDE.md rule 5).
-- Only an account INVITED by an admin (auth.users.invited_at — inviteUserByEmail needs the service
-- key, /platform/echipa) that is confirmed, not banned, not deleted can be promoted: local and
-- possibly production GoTrue auto-confirm signups (GOTRUE_MAILER_AUTOCONFIRM), so "confirmed" alone
-- would let a stranger who pre-registered a colleague's email become admin (red-team round 5).
-- All admin rows are locked first, so two admins revoking each other at once serialize: the second
-- call then fails has_role. With "not yourself" that already leaves one admin, so there is no
-- separate "last admin" count (it was unreachable). The one other path that changes a role,
-- review_onboarding_application, now refuses an applicant who is platform_admin: before, the last
-- admin could approve their own courier application and leave the platform with zero admins.
-- profiles_guard_role lets this through because the function runs as its owner (security definer).

create or replace function public.admin_set_platform_admin(p_email text, p_grant boolean, p_reason text)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_target uuid;
  v_role text;
begin
  if not public.has_role('platform_admin') then raise exception 'Doar un administrator poate să acorde sau să retragă acest drept.'; end if;
  perform 1 from public.profiles where role = 'platform_admin' order by id for update;  -- serialize team changes
  if not public.has_role('platform_admin') then raise exception 'Dreptul tău de administrator a fost retras între timp.'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'Scrie motivul (minim 5 caractere) — rămâne în audit.'; end if;
  select u.id into v_target from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_target is null then raise exception 'Nu există niciun cont cu acest email.'; end if;
  if p_grant and not exists (select 1 from auth.users u where u.id = v_target and u.invited_at is not null) then
    raise exception 'Doar un cont invitat de un administrator (din Echipă → Invită) poate deveni administrator; acesta s-a înscris singur.';
  end if;
  if p_grant and not exists (select 1 from auth.users u where u.id = v_target and u.email_confirmed_at is not null
                             and u.deleted_at is null and (u.banned_until is null or u.banned_until < now())) then
    raise exception 'Contul nu a acceptat încă invitația, e blocat sau e șters; nu poate deveni administrator.';
  end if;
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

-- review_onboarding_application: live body (pg_get_functiondef, 2026-10-13) + one delta — refuse an
-- applicant who is platform_admin. Otherwise approving the application rewrote the role to courier /
-- restaurant_partner with no lock and no guard; the last admin could do it to themselves.
create or replace function public.review_onboarding_application(p_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_app public.onboarding_applications%rowtype; v_rid uuid; v_slug text; v_base text; v_n int := 0;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select * into v_app from public.onboarding_applications where id = p_id for update;
  if not found then raise exception 'application not found'; end if;
  if v_app.status <> 'pending' then raise exception 'already reviewed'; end if;

  if not p_approve then
    update public.onboarding_applications set status = 'rejected', review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
    return;
  end if;
  if v_app.user_id is null then raise exception 'applicant user missing'; end if;
  -- 20261012000492 (one delta on the live body): an admin cannot be demoted through onboarding.
  if exists (select 1 from public.profiles where id = v_app.user_id and role = 'platform_admin') then
    raise exception 'Un administrator nu poate fi înscris ca curier sau partener; retrage-i întâi dreptul de administrator din Echipă.';
  end if;

  if v_app.applicant_type = 'courier' then
    update public.profiles set role = 'courier' where id = v_app.user_id;
    insert into public.couriers (user_id, full_name, phone, vehicle_type, status, is_active)
    values (v_app.user_id, v_app.full_name, v_app.phone, coalesce(v_app.details ->> 'vehicle_type', 'car'), 'offline', true)
    on conflict (user_id) do nothing;
  else
    update public.profiles set role = 'restaurant_partner' where id = v_app.user_id;
    v_base := nullif(regexp_replace(lower(coalesce(v_app.details ->> 'slug', v_app.details ->> 'name', v_app.full_name)), '[^a-z0-9]+', '-', 'g'), '');
    v_base := coalesce(trim(both '-' from v_base), 'rest-' || left(v_app.id::text, 8));
    v_slug := v_base;
    while exists (select 1 from public.restaurants where slug = v_slug) and v_n < 100 loop
      v_n := v_n + 1; v_slug := v_base || '-' || v_n;
    end loop;
    if v_n >= 100 then v_slug := v_base || '-' || left(v_app.id::text, 8); end if;
    insert into public.restaurants (slug, name, cuisine_type, address, sector, phone, is_active, accepting_orders, delivery_fee_mdl, min_order_amount_mdl, avg_prep_minutes)
    values (
      v_slug,
      coalesce(v_app.details ->> 'name', v_app.full_name),
      case when v_app.details ->> 'cuisine_type' in ('sushi','fine_dining','other') then v_app.details ->> 'cuisine_type' else 'other' end,
      coalesce(v_app.details ->> 'address', ''), v_app.details ->> 'sector', v_app.phone, false, false,
      least(greatest(coalesce((v_app.details ->> 'delivery_fee_mdl')::numeric, 40), 0), 200),
      least(greatest(coalesce((v_app.details ->> 'min_order_amount_mdl')::numeric, 150), 0), 1000),
      least(greatest(coalesce((v_app.details ->> 'avg_prep_minutes')::int, 30), 5), 180)
    ) returning id into v_rid;
    insert into public.restaurant_staff (user_id, restaurant_id) values (v_app.user_id, v_rid) on conflict do nothing;
    -- #11: default weekly hours so the place_order gate doesn't block orders the
    -- moment the restaurant is activated. Partner edits these in the Hours screen.
    insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
    select v_rid, d, '10:00'::time, '22:00'::time, false from generate_series(0, 6) d;
  end if;

  update public.onboarding_applications set status = 'approved', review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
end; $function$;
