-- ============================================================================
-- MARELE AUDIT 2026-08-03 — RestPartnerAudit #1 (CRIT)
--
-- `restaurants_staff_write` is a row-level UPDATE policy (has_restaurant_access)
-- with NO column scoping, and `authenticated` holds table-level UPDATE. The
-- existing guard (20260725000200) only reverts `is_active` and `slug`. That
-- left the money-/dispatch-critical columns freely writable by any partner via
-- a direct Supabase REST UPDATE with their own session:
--   - delivery_fee_mdl        → place_order stamps it onto every new order
--                               (orders.delivery_fee_mdl), so a partner could
--                               set the fee charged to customers in real time.
--   - min_order_amount_mdl    → place_order's order-minimum gate.
--   - catering_min_amount_mdl → same, catering path.
--   - accept_sla_minutes      → expire_stale_orders() reads it; inflating it
--                               disables the partner's own auto-cancel SLA.
--   - avg_prep_minutes        → ETA input.
--   - lat / lng               → dispatch distance/scoring + delivery-fee geo.
--
-- This contradicts the rest of the codebase, where every money field is
-- versioned+immutable+admin-only (pricing_config, courier_tariff_config,
-- orders.delivery_fee_mdl is write-once via guard_delivery_fee_floor).
--
-- Fix: expand the SAME guard trigger (mirrors guard_rating_columns) to revert
-- the platform-/money-/geo-controlled columns on any write that is neither the
-- table owner (a SECURITY DEFINER RPC running as owner) nor a platform_admin.
-- Partner self-service columns stay editable: accepting_orders (hours page
-- toggle — the only restaurants column the app writes as a partner), plus the
-- storefront cosmetics name/cuisine_type/description/logo_url/cover_photo_url/
-- address/sector/phone/accepts_catering.
--
-- `geo` is GENERATED ALWAYS from lat/lng — never assigned here; reverting
-- lat/lng reverts geo automatically. rating_avg/rating_count stay guarded by
-- guard_rating_columns.
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

  return new;
end;
$$;

drop trigger if exists restaurants_guard_platform_cols on public.restaurants;
create trigger restaurants_guard_platform_cols
  before update on public.restaurants
  for each row execute function public.guard_restaurant_platform_columns();
