-- SecurityAudit (adversarial, 2026-07-31) — 2 LOW hardening items. The audit
-- found NO exploitable hole; these convert two IMPLICIT safety invariants into
-- EXPLICIT ones before the pilot scales.
--
-- #1: 4 admin/service-only RPCs are EXECUTE-able by anon — the privilege rides on
-- the default PUBLIC grant (leading `=X` in proacl), so `revoke from anon` is a
-- no-op; it must come off PUBLIC. Each is already guarded internally
-- (has_role/service_role) so it's not exploitable — revoke anyway to match intent.
-- `authenticated` keeps its own explicit grant (admins call via has_role);
-- confirm_online_payment's service caller currently rides PUBLIC, so pin it to
-- service_role explicitly before removing PUBLIC.
grant execute on function public.confirm_online_payment(uuid, boolean, text) to service_role;
revoke execute on function public.admin_mark_payout_paid(uuid) from public;
revoke execute on function public.admin_update_payment_status(uuid, text, text) from public;
revoke execute on function public.review_onboarding_application(uuid, boolean, text) from public;
revoke execute on function public.confirm_online_payment(uuid, boolean, text) from public;

-- #2: 8 of 9 admin_* views (all security_invoker=on) rely SILENTLY on the
-- underlying orders/couriers/events RLS staying tight — they have no explicit
-- admin gate of their own (unlike admin_dispatch_metrics). Today that's safe
-- (probed: zero cross-tenant leakage), but any future policy broadening on a
-- base table would instantly turn one into a platform-wide leak (courier
-- phone+GPS, every delivery address, referral codes) with no independent net.
-- Add `where has_role('platform_admin')` to each, matching the dispatch_metrics
-- precedent. Done programmatically from the LIVE viewdef (no body duplication);
-- security_invoker is preserved so base-table RLS still evaluates as the caller.
-- Idempotency guard: skip a view already carrying the gate (safe re-apply).
do $$
declare
  v text;
  body text;
  views text[] := array[
    'admin_fleet_status', 'admin_order_board', 'admin_payment_queue',
    'admin_restaurant_kpis', 'admin_stuck_orders', 'admin_wait_metrics',
    'admin_courier_pilot_kpis', 'admin_referral_progress'
  ];
begin
  foreach v in array views loop
    body := pg_get_viewdef(('public.' || v)::regclass, true);
    if body ilike '%has_role(''platform_admin'')%' then
      continue; -- already gated (re-apply) — do not double-wrap
    end if;
    body := regexp_replace(body, ';\s*$', '');
    execute format(
      'create or replace view public.%I with (security_invoker = on) as ' ||
      'select sub.* from (%s) sub where public.has_role(''platform_admin'')',
      v, body
    );
  end loop;
end $$;
