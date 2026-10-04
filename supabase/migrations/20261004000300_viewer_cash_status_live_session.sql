-- get_courier_cash_status() is on the viewer allowlist (the viewed courier page calls it) and is
-- SECURITY DEFINER, so the restrictive viewer_session_live policies never apply inside it: after
-- "Ieși" (end_view_as) the viewer token still read the courier's cash balance and cap until the
-- JWT expired (view-as regression verifier, 2026-10-04). Live body + ONE delta: a viewer needs a
-- live session, like every table it reads.
create or replace function public.get_courier_cash_status()
 returns table(balance_mdl numeric, cap_mdl numeric, reactivation_threshold_mdl numeric, offload_channel_text text)
 language plpgsql
 stable security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_courier_id uuid := public.current_courier_id();
  v_policy public.cash_policy;
begin
  if (auth.jwt() ->> 'role') = 'viewer' and not public.viewer_session_live() then
    raise exception 'Sesiunea „vezi ca" s-a încheiat.' using errcode = '42501';
  end if;
  if v_courier_id is null then raise exception 'not a courier'; end if;
  v_policy := public.current_cash_policy();
  return query select public.courier_cash_balance(v_courier_id),
                      public.effective_cash_cap(v_courier_id),
                      v_policy.reactivation_threshold_mdl,
                      v_policy.offload_channel_text;
end;
$function$;
