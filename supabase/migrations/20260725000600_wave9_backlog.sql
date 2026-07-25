-- ============================================================================
-- WAVE 9 — MED/LOW backlog from the master audit (wf_0f39c4d6-749)
--  #11 [MED] onboarding-approved restaurants had no restaurant_hours, so once an
--     admin activated one the new place_order hours-gate rejected every order with
--     a misleading "închis" error. Seed sane default hours (Mon–Sun 10:00–22:00)
--     on approval — the partner adjusts them before/after going live.
-- ============================================================================
create or replace function public.review_onboarding_application(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, auth
as $$
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
end; $$;
