-- Rollback of 20261012000308. Confirmations are lost (re-confirm after re-applying).
drop trigger if exists restaurants_pin_unconfirm_on_move on public.restaurants;
drop function if exists public.clear_pin_confirmation_on_move();
drop function if exists public.confirm_restaurant_pin(uuid);

CREATE OR REPLACE FUNCTION public.guard_restaurant_platform_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth'
AS $function$
declare v_privileged boolean;
begin
  -- INVOKER context: current_user is the real writer (postgres when a definer RPC
  -- runs as owner; authenticated on a direct client UPDATE).
  select coalesce(bool_or(rolbypassrls or rolsuper), false) into v_privileged
  from pg_roles where rolname = current_user;
  if v_privileged or public.has_role('platform_admin') then
    return new; -- owner/definer or a platform admin may moderate these fields
  end if;

  -- Platform-/moderation-controlled (unchanged from 20260725000200):
  new.is_active := old.is_active;
  new.slug := old.slug;

  -- Money-/dispatch-critical: partners must not self-set what the platform
  -- charges customers, pays couriers, or feeds to the SLA/ETA/dispatch engines.
  new.delivery_fee_mdl := old.delivery_fee_mdl;
  new.min_order_amount_mdl := old.min_order_amount_mdl;
  new.catering_min_amount_mdl := old.catering_min_amount_mdl;
  new.accept_sla_minutes := old.accept_sla_minutes;
  new.avg_prep_minutes := old.avg_prep_minutes;
  new.lat := old.lat;
  new.lng := old.lng;
  -- Busy mode feeds the ETA too: only through set_restaurant_busy (0/15/30/45, 1 h).
  new.busy_extra_minutes := old.busy_extra_minutes;
  new.busy_until := old.busy_until;

  return new;
end;
$function$;

alter table public.restaurants drop column if exists pin_confirmed_at;
