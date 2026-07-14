-- Hardening from Supabase security advisors:
-- 1) Postgres grants EXECUTE to PUBLIC by default on new functions, so every
--    state-changing security-definer RPC was callable by `anon`. Not
--    exploitable (each RPC re-checks auth.uid()/role internally), but
--    defense-in-depth says strip it.
-- 2) set_updated_at/generate_order_number had a mutable search_path.
--
-- Deliberately NOT revoked from anon: has_role/has_any_role/
-- has_restaurant_access — they execute inside RLS policies with the
-- privileges of the querying user, including anonymous menu browsing
-- (menu_items_public_read), and safely return false without a session.

alter function public.set_updated_at() set search_path = public;
alter function public.generate_order_number() set search_path = public;

revoke execute on function public.place_order(uuid, text, text, jsonb, uuid, timestamptz, text, jsonb) from public, anon;
revoke execute on function public.accept_order(uuid) from public, anon;
revoke execute on function public.reject_order(uuid, text) from public, anon;
revoke execute on function public.mark_ready_for_pickup(uuid) from public, anon;
revoke execute on function public.assign_courier(uuid) from public, anon;
revoke execute on function public.advance_delivery_status(uuid, text, boolean) from public, anon;
revoke execute on function public.set_courier_online_status(text) from public, anon;
revoke execute on function public.cancel_order(uuid, text) from public, anon;
revoke execute on function public.submit_catering_quote(uuid, numeric) from public, anon;
revoke execute on function public.decline_catering_quote(uuid, text) from public, anon;
revoke execute on function public.confirm_catering_quote(uuid) from public, anon;

-- Trigger/internal functions: not REST-callable by anyone. Triggers run as
-- the table owner; the DEFAULT on orders.order_number evaluates inside the
-- security-definer place_order, so no client role needs EXECUTE.
revoke execute on function public.handle_new_customer_signup() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.generate_order_number() from public, anon, authenticated;
