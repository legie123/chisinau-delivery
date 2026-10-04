-- submit_courier_satisfaction: the survey week is the Europe/Chisinau calendar
-- week, not the session-zone (UTC) one. Recreated from the LIVE body
-- (pg_get_functiondef) with ONE delta on v_week.
--
-- Bug: the session runs in UTC, so date_trunc('week', now()) keyed Monday
-- 00:00–02:59 local (Sunday 21:00–23:59 UTC) to the PREVIOUS week, while the
-- courier pages (shared-domain currentWeekRange().startDate) ask for the
-- Chisinau Monday — the "already answered" lookup missed and the prompt came
-- back. Both sides now use the same Chisinau Monday.
create or replace function public.submit_courier_satisfaction(p_stars integer, p_comment text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_courier_id uuid;
  v_week date := date_trunc('week', now() at time zone 'Europe/Chisinau')::date;
  v_existing public.courier_satisfaction_surveys%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'stars must be 1-5'; end if;

  select id into v_courier_id from public.couriers where user_id = auth.uid();
  if v_courier_id is null then raise exception 'not a courier'; end if;

  select * into v_existing from public.courier_satisfaction_surveys
  where courier_id = v_courier_id and week_start = v_week;
  if found then
    if v_existing.stars = p_stars then return; end if;
    raise exception 'ai răspuns deja la sondajul acestei săptămâni';
  end if;

  insert into public.courier_satisfaction_surveys (courier_id, week_start, stars, comment)
  values (v_courier_id, v_week, p_stars, nullif(trim(p_comment), ''));
end;
$function$;
