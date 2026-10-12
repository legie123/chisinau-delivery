-- Rollback of 20261012000301 (apply 20261012000304's rollback first). get_prep_estimates back
-- to its 20260727001800_eta_p90 body; busy columns dropped (current busy windows are lost).

create or replace function public.get_prep_estimates(p_restaurant_ids uuid[])
 returns table(restaurant_id uuid, prep_minutes integer, source text, sample_count integer, p90_prep_minutes numeric)
 language sql
 stable
 set search_path to 'public'
as $function$
  select r.id,
         coalesce(hb.avg_prep_minutes::int, ov.avg_all::int, r.avg_prep_minutes),
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

drop function if exists public.set_restaurant_busy(uuid, int);
alter table public.restaurants drop column if exists busy_extra_minutes, drop column if exists busy_until;
