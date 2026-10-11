-- Busy mode for the kitchen tablet (+15/30/45 min). One hour, then it lapses on its
-- own: a forgotten busy flag would silently push every ETA up all evening.
-- ponytail: fixed 1h window; make it configurable if partners ask for longer.

alter table public.restaurants
  add column busy_extra_minutes smallint not null default 0
    constraint restaurants_busy_extra_minutes_chk check (busy_extra_minutes in (0, 15, 30, 45)),
  add column busy_until timestamptz;

create or replace function public.set_restaurant_busy(p_restaurant_id uuid, p_extra_minutes int)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if not has_restaurant_access(p_restaurant_id) then raise exception 'not authorized'; end if;
  if p_extra_minutes not in (0, 15, 30, 45) then
    raise exception 'Timp suplimentar invalid: alege 15, 30 sau 45 de minute.';
  end if;
  update public.restaurants
  set busy_extra_minutes = p_extra_minutes,
      busy_until = case when p_extra_minutes = 0 then null else now() + interval '1 hour' end
  where id = p_restaurant_id;
end;
$function$;

revoke all on function public.set_restaurant_busy(uuid, int) from public, anon;
grant execute on function public.set_restaurant_busy(uuid, int) to authenticated, service_role;

-- get_prep_estimates: live body (20260717001400) + one delta — the busy extra is
-- added while busy_until is in the future. accept_order reads this function, so the
-- accepted order's estimated_ready_at inherits it with no change to accept_order.
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
