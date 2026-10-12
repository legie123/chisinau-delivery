-- Empty state "no couriers" for the customer app (parity row). couriers_available() returns whether
-- ANY active courier is online right now — a single boolean, never a count, an identity or a
-- position (couriers RLS stays closed to customers). Home shows "toți curierii sunt ocupați" so the
-- customer knows before ordering; ordering is not blocked (dispatch waves keep trying, and the
-- no-courier cut-off cancels with a push).
-- Rollback: drop function public.couriers_available();

create or replace function public.couriers_available()
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.couriers c where c.is_active and c.status = 'online');
$function$;

revoke all on function public.couriers_available() from public, anon;
grant execute on function public.couriers_available() to authenticated, service_role;
