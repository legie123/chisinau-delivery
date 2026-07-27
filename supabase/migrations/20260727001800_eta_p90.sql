-- DB hygiene wave, order 9/8+2 — p90 prep-time joins the point estimate so the
-- customer-facing range (formatPrepRange, src/lib/orders/eta.ts) can widen for
-- a restaurant whose prep time is genuinely variable and stay tight for one
-- that's consistent, instead of a flat +15min buffer for everyone.
--
-- get_prep_estimates' RETURNS TABLE is implemented as OUT parameters — Postgres
-- refuses to append a column to those via CREATE OR REPLACE FUNCTION ("cannot
-- change return type of existing function"; verified live). DROP + CREATE is
-- the only path; get_prep_estimates has no catalog-tracked dependents (its
-- only callers, accept_order/get_prep_estimates call-sites, are plpgsql bodies
-- — opaque to pg_depend), so the drop is safe without CASCADE.
drop function if exists public.get_prep_estimates(uuid[]);

-- p90_all mirrors avg_all's existing approximation (weighted mean of the
-- per-hour-bucket stat, weighted by sample_count) rather than a true global
-- percentile recompute — restaurant_prep_stats only stores the per-bucket p90,
-- not raw samples, so an exact overall percentile isn't available without
-- re-scanning delivery_status_events (refresh_prep_stats' job, not a read
-- path). Same fallback ladder as before (hourly >=5 -> overall >=5 -> static);
-- p90_prep_minutes is null-safe — the static tier carries no percentile data
-- so it stays null, and callers (formatPrepRange) already treat null as
-- "fall back to the fixed buffer".
create function public.get_prep_estimates(p_restaurant_ids uuid[])
returns table (restaurant_id uuid, prep_minutes int, source text, sample_count int, p90_prep_minutes numeric)
language sql
stable
set search_path = public
as $$
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
$$;
grant execute on function public.get_prep_estimates(uuid[]) to anon, authenticated;
