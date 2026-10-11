-- Rollback of 20261012000304: guard back to its 20260803000000 body, get_prep_estimates
-- back to the 20261012000301 body (busy minutes on prep only, not on p90).

create or replace function public.guard_restaurant_platform_columns()
 returns trigger
 language plpgsql
 set search_path to 'public', 'auth'
as $function$
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
$function$;

create or replace function public.get_prep_estimates(p_restaurant_ids uuid[])
 returns table(restaurant_id uuid, prep_minutes integer, source text, sample_count integer, p90_prep_minutes numeric)
 language sql
 stable
 set search_path to 'public'
as $function$
  select r.id,
         coalesce(hb.avg_prep_minutes::int, ov.avg_all::int, r.avg_prep_minutes)
           + case when r.busy_until > now() then r.busy_extra_minutes else 0 end,
         case when hb.avg_prep_minutes is not null then 'hourly'
              when ov.avg_all is not null then 'overall'
              else 'static' end,
         coalesce(hb.sample_count, ov.n_total, 0),
         coalesce(hb.p90_prep_minutes, ov.p90_all)
  from public.restaurants r
  left join lateral (
    select s.avg_prep_minutes, s.sample_count, s.p90_prep_minutes
    from public.restaurant_prep_stats s
    where s.restaurant_id = r.id
      and s.hour_of_day = date_part('hour', now() at time zone 'Europe/Chisinau')::int
      and s.sample_count >= 5
  ) hb on true
  left join lateral (
    select (sum(s.avg_prep_minutes * s.sample_count) / sum(s.sample_count)) as avg_all,
           sum(s.sample_count)::int as n_total,
           (sum(s.p90_prep_minutes * s.sample_count) / sum(s.sample_count)) as p90_all
    from public.restaurant_prep_stats s
    where s.restaurant_id = r.id
    having sum(s.sample_count) >= 5
  ) ov on true
  where r.id = any(p_restaurant_ids);
$function$;
