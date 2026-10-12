-- Pin rule A (owner decision 2026-10-12): a restaurant is activated only with a pin the partner
-- confirmed on the map as the pickup door. This migration is the RESTAURANT half: the
-- confirmation itself. ADMIN gates activation on it (cross-request).
-- - restaurants.pin_confirmed_at, set only by confirm_restaurant_pin (own staff, pin present);
-- - cleared by trigger whenever lat/lng change (a moved pin needs a new confirmation);
-- - guard_restaurant_platform_columns (live body + one delta) reverts direct writes to it.
-- Rollback: supabase/rollbacks/20261012000308_restaurant_pin_confirmation.down.sql

alter table public.restaurants add column pin_confirmed_at timestamptz;

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
  -- Pin confirmation: only through confirm_restaurant_pin (000308).
  new.pin_confirmed_at := old.pin_confirmed_at;

  return new;
end;
$function$;

create or replace function public.confirm_restaurant_pin(p_restaurant_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare v_lat numeric; v_lng numeric; v_at timestamptz := now();
begin
  if not has_restaurant_access(p_restaurant_id) then raise exception 'not authorized'; end if;
  select lat, lng into v_lat, v_lng from public.restaurants where id = p_restaurant_id;
  if v_lat is null or v_lng is null then
    raise exception 'Localul nu are încă pin pe hartă — cere echipei Dragons să-l fixeze.';
  end if;
  update public.restaurants set pin_confirmed_at = v_at where id = p_restaurant_id;
  return v_at;
end;
$function$;

revoke all on function public.confirm_restaurant_pin(uuid) from public, anon;
grant execute on function public.confirm_restaurant_pin(uuid) to authenticated, service_role;

create or replace function public.clear_pin_confirmation_on_move()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.lat is distinct from old.lat or new.lng is distinct from old.lng then
    new.pin_confirmed_at := null;
  end if;
  return new;
end;
$function$;

-- Runs after restaurants_guard_platform_cols (alphabetical), so a partner's reverted lat/lng
-- never counts as a move.
create trigger restaurants_pin_unconfirm_on_move
  before update of lat, lng on public.restaurants
  for each row execute function public.clear_pin_confirmation_on_move();
