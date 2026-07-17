-- WS4 — Dynamic ETA (historical prep-time, research §2.5)
-- Replaces the static restaurants.avg_prep_minutes display with a data-driven
-- estimate: a pg_cron-refreshed rolling 28-day avg/p90 of accepted->ready_for_pickup
-- durations, bucketed by hour-of-day (Europe/Chisinau). accept_order stamps
-- orders.estimated_ready_at at acceptance; the existing row-filtered realtime
-- subscription pushes it to the customer tracking page for a live countdown.
-- Single additive migration, no destructive change, no write path outside RPCs.

-- 1. Per-order ETA snapshot, stamped by accept_order at acceptance time.
alter table public.orders
  add column if not exists estimated_ready_at timestamptz;

-- 2. Rolling aggregate: accepted -> ready_for_pickup minutes, per restaurant per hour-of-day.
create table if not exists public.restaurant_prep_stats (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  hour_of_day int not null check (hour_of_day between 0 and 23),
  sample_count int not null,
  avg_prep_minutes numeric(6,1) not null,
  p90_prep_minutes numeric(6,1) not null,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, hour_of_day)
);

alter table public.restaurant_prep_stats enable row level security;

-- Same exposure class as restaurants public read (non-sensitive, feeds the browse UI pre-login).
drop policy if exists "prep_stats_public_read" on public.restaurant_prep_stats;
create policy "prep_stats_public_read" on public.restaurant_prep_stats
  for select using (true);
-- Deliberately NO insert/update policy — written only by refresh_prep_stats()
-- (security definer, runs as owner), mirroring the delivery_status_events pattern.

-- 3. Aggregate refresher — pg_cron only, never REST-exposed (WS1 sweeper pattern).
create or replace function public.refresh_prep_stats()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  with prep as (
    select
      o.restaurant_id,
      date_part('hour', acc.at at time zone 'Europe/Chisinau')::int as hod,
      extract(epoch from (rdy.at - acc.at)) / 60.0 as prep_min
    from public.orders o
    join lateral (
      select min(created_at) as at from public.delivery_status_events e
      where e.order_id = o.id and e.status = 'accepted'
    ) acc on acc.at is not null
    join lateral (
      select min(created_at) as at from public.delivery_status_events e
      where e.order_id = o.id and e.status = 'ready_for_pickup'
    ) rdy on rdy.at is not null
    where o.order_type = 'standard'          -- catering is event-scheduled; would poison the stats
      and o.created_at > now() - interval '28 days'
  ),
  agg as (
    select restaurant_id, hod, count(*) as n,
           round(avg(prep_min)::numeric, 1) as avg_min,
           round((percentile_cont(0.9) within group (order by prep_min))::numeric, 1) as p90_min
    from prep
    where prep_min between 2 and 180         -- outlier guard: fat-finger accepts / forgotten orders
    group by 1, 2
  )
  insert into public.restaurant_prep_stats (restaurant_id, hour_of_day, sample_count, avg_prep_minutes, p90_prep_minutes, updated_at)
  select restaurant_id, hod, n, avg_min, p90_min, now() from agg
  on conflict (restaurant_id, hour_of_day) do update
    set sample_count = excluded.sample_count,
        avg_prep_minutes = excluded.avg_prep_minutes,
        p90_prep_minutes = excluded.p90_prep_minutes,
        updated_at = excluded.updated_at;
  get diagnostics v_rows = row_count;
  -- hygiene: drop buckets not refreshed inside ~the window anymore
  delete from public.restaurant_prep_stats where updated_at < now() - interval '35 days';
  return v_rows;
end;
$$;
revoke execute on function public.refresh_prep_stats() from public, anon, authenticated;

-- 4. Estimate reader — security INVOKER (stats + restaurants are public-read), REST-exposed.
create or replace function public.get_prep_estimates(p_restaurant_ids uuid[])
returns table (restaurant_id uuid, prep_minutes int, source text, sample_count int)
language sql
stable
set search_path = public
as $$
  select r.id,
         coalesce(hb.avg_prep_minutes::int, ov.avg_all::int, r.avg_prep_minutes),
         case when hb.avg_prep_minutes is not null then 'hourly'
              when ov.avg_all is not null then 'overall'
              else 'static' end,
         coalesce(hb.sample_count, ov.n_total, 0)
  from public.restaurants r
  left join lateral (
    select s.avg_prep_minutes, s.sample_count
    from public.restaurant_prep_stats s
    where s.restaurant_id = r.id
      and s.hour_of_day = date_part('hour', now() at time zone 'Europe/Chisinau')::int
      and s.sample_count >= 5
  ) hb on true
  left join lateral (
    select (sum(s.avg_prep_minutes * s.sample_count) / sum(s.sample_count)) as avg_all,
           sum(s.sample_count)::int as n_total
    from public.restaurant_prep_stats s
    where s.restaurant_id = r.id
    having sum(s.sample_count) >= 5
  ) ov on true
  where r.id = any(p_restaurant_ids);
$$;
grant execute on function public.get_prep_estimates(uuid[]) to anon, authenticated;

-- 5. accept_order — WS1 (20260708001300) body copied VERBATIM (for update, idempotent
-- no-op, has_restaurant_access check, event insert) with exactly ONE change: the UPDATE
-- also stamps estimated_ready_at for standard orders. NOT a state-machine redesign.
-- Any future change to accept_order must edit THIS (the latest) definition.
create or replace function public.accept_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status = 'accepted' then return; end if; -- idempotent no-op (WS1)
  if v_order.status <> 'pending_restaurant' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders
  set status = 'accepted',
      estimated_ready_at = case when v_order.order_type = 'standard'
        then now() + make_interval(mins => (select ge.prep_minutes from public.get_prep_estimates(array[v_order.restaurant_id]) ge))
        else null end
  where id = p_order_id;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'accepted', (select role from public.profiles where id = auth.uid()), auth.uid());
end;
$$;
-- confirm_catering_quote intentionally untouched: catering readiness = event_date, not prep ETA.

-- 6. Cron: refresh every 15 min (pg_cron already active from WS1). Guarded re-apply.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-prep-stats') then
    perform cron.unschedule('refresh-prep-stats');
  end if;
end
$do$;
select cron.schedule('refresh-prep-stats', '*/15 * * * *', $$select public.refresh_prep_stats();$$);
