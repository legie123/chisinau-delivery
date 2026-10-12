-- 20261012000308 created the trigger function clear_pin_confirmation_on_move() with the
-- default EXECUTE for PUBLIC, so the viewer (and anon) roles could call a VOLATILE function —
-- sim 73.a3 caught it. A trigger fires without the caller holding EXECUTE, so revoke it all.
-- Rollback: supabase/rollbacks/20261012000309_pin_trigger_fn_grants.down.sql
revoke all on function public.clear_pin_confirmation_on_move() from public, anon, authenticated;
