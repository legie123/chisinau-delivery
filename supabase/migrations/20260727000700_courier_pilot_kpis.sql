-- Master-audit Faza 5 #5 — instrumentation for the two go/no-go KPIs that were
-- previously unmeasurable: weekly courier satisfaction (target >=4.5/5, Wolt
-- benchmark 4.57/5) and gross earnings PER SHIFT (target 600-1000 MDL/tura
-- completa). Both feed the density-vs-earnings feedback loop the wisdom-debate
-- gate needs numbers for, not vibes. Purely additive: two new tables, one
-- extended RPC, one new RPC, one safety-net cron, one admin KPI view.

-- ---------------------------------------------------------------------------
-- 1. courier_shifts — one row per continuous online session. A "tura" is
--    exactly the span between a courier going online and going offline; it
--    survives multiple deliveries in between (courier.status cycles
--    online -> on_delivery -> online without ever closing the shift — see
--    20260725000400_wave4_correctness.sql for that state ownership).
--    Deliberately NO money column here: gross-per-shift is recomputed from
--    orders at read time (same "recompute from source, no drift" philosophy
--    as submit_rating's aggregate recompute), so a later refund/clawback on a
--    delivery never leaves a shift snapshot silently wrong.
-- ---------------------------------------------------------------------------
create table public.courier_shifts (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.couriers(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

-- Invariant: a courier has at most one OPEN shift, ever.
create unique index courier_shifts_one_open_idx on public.courier_shifts(courier_id) where ended_at is null;
create index courier_shifts_courier_started_idx on public.courier_shifts(courier_id, started_at desc);

alter table public.courier_shifts enable row level security;

create policy courier_shifts_self_read on public.courier_shifts
  for select using (courier_id = public.current_courier_id());
create policy courier_shifts_admin_read on public.courier_shifts
  for select using (has_role('platform_admin'));
-- No insert/update/delete policy: rows are written ONLY by
-- set_courier_online_status() (security definer, below) and the
-- close_stale_courier_shifts() safety-net cron — same RPC-only pattern as
-- delivery_status_events / ratings / courier_suspensions.

revoke all on public.courier_shifts from anon;
grant select on public.courier_shifts to authenticated;

-- Hot join for the per-shift earnings computation below AND for the existing
-- weekly earnings query in src/app/(courier)/_lib/earnings.ts (currently
-- scanning orders_courier_idx + filtering delivered_at in application code).
create index orders_courier_delivered_paid_idx on public.orders(courier_id, delivered_at)
  where status = 'delivered' and payment_status = 'paid';

-- ---------------------------------------------------------------------------
-- 2. courier_satisfaction_surveys — weekly in-app 1-5 pulse (audit §Faza 5 #5,
--    Wolt benchmark 4.57/5). week_start is computed SERVER-SIDE from now() via
--    date_trunc('week', ...) (Postgres ISO weeks start Monday) — never trusted
--    from the client, and it's the SAME Mon-Sun boundary payout periods and
--    currentWeekRange() (courier earnings page) already use.
-- ---------------------------------------------------------------------------
create table public.courier_satisfaction_surveys (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.couriers(id) on delete cascade,
  week_start date not null,
  stars int not null check (stars between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (courier_id, week_start)
);

create index courier_satisfaction_courier_week_idx on public.courier_satisfaction_surveys(courier_id, week_start desc);

alter table public.courier_satisfaction_surveys enable row level security;

create policy courier_satisfaction_self_read on public.courier_satisfaction_surveys
  for select using (courier_id = public.current_courier_id());
create policy courier_satisfaction_admin_read on public.courier_satisfaction_surveys
  for select using (has_role('platform_admin'));
-- No insert/update/delete policy — writes go ONLY through
-- submit_courier_satisfaction() below (same RPC-only pattern as ratings).

revoke all on public.courier_satisfaction_surveys from anon;
grant select on public.courier_satisfaction_surveys to authenticated;

-- ---------------------------------------------------------------------------
-- 3. set_courier_online_status — extended (body only; signature unchanged,
--    every existing caller/grant/revoke keeps working) to open/close the
--    shift log. Preserves the #30/#52 guards from wave4_correctness verbatim.
-- ---------------------------------------------------------------------------
create or replace function public.set_courier_online_status(p_status text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_courier public.couriers%rowtype;
begin
  if p_status not in ('offline', 'online') then raise exception 'invalid status'; end if;
  select * into v_courier from public.couriers where user_id = auth.uid() and is_active for update;
  if not found then raise exception 'not an active courier'; end if;
  -- #30: mid-delivery state is owned by the order lifecycle, not the toggle.
  if v_courier.status = 'on_delivery' then
    raise exception 'ai o livrare activă — finalizeaz-o înainte să schimbi statusul';
  end if;

  -- Idempotent no-op on a redundant toggle (e.g. two tabs) — must NOT open a
  -- second shift or double-close the current one.
  if v_courier.status = p_status then
    return;
  end if;

  if p_status = 'online' then
    insert into public.courier_shifts (courier_id, started_at) values (v_courier.id, now());
  else
    update public.courier_shifts set ended_at = now()
    where courier_id = v_courier.id and ended_at is null;
  end if;

  update public.couriers set status = p_status where id = v_courier.id;
  -- #52: going dark declines any live offer; the expire sweeper re-dispatches.
  if p_status = 'offline' then
    update public.dispatch_offers set status = 'declined', responded_at = now()
    where courier_id = v_courier.id and status = 'offered';
  end if;
end;
$$;
-- Grants unchanged from 20260725000400_wave4_correctness.sql (CREATE OR REPLACE
-- preserves them), restated here for anyone reading migrations top-to-bottom:
revoke execute on function public.set_courier_online_status(text) from public, anon;
grant execute on function public.set_courier_online_status(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. submit_courier_satisfaction — the weekly pulse write path. Same shape as
--    submit_rating: identical-value retry is a silent no-op (idempotent double
--    submit), a DIFFERENT value on an already-answered week is rejected
--    (immutable — this is a trend series, not an editable profile field).
-- ---------------------------------------------------------------------------
create or replace function public.submit_courier_satisfaction(p_stars int, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_courier_id uuid;
  v_week date := date_trunc('week', now())::date;
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
$$;
revoke execute on function public.submit_courier_satisfaction(int, text) from public, anon;
grant execute on function public.submit_courier_satisfaction(int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Safety net: a courier whose app dies mid-shift (crash, dead battery)
--    never calls set_courier_online_status('offline'), so the shift — and
--    couriers.status='online' — would hang open forever, corrupting the
--    per-shift earnings KPI with one shift spanning days. Cap it, same
--    pattern as expire_stale_orders / expire_dispatch_offers.
-- ---------------------------------------------------------------------------
create or replace function public.close_stale_courier_shifts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  update public.courier_shifts
  set ended_at = started_at + interval '16 hours'
  where ended_at is null and started_at < now() - interval '16 hours';
  get diagnostics v_n = row_count;

  -- Keep couriers.status honest: nothing should read as "online" once its
  -- shift has been force-closed and no other open shift exists for them.
  update public.couriers c
  set status = 'offline'
  where c.status = 'online'
    and not exists (
      select 1 from public.courier_shifts cs where cs.courier_id = c.id and cs.ended_at is null
    );

  return v_n;
end;
$$;
revoke execute on function public.close_stale_courier_shifts() from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'close-stale-courier-shifts') then
    perform cron.unschedule('close-stale-courier-shifts');
  end if;
end
$do$;
select cron.schedule('close-stale-courier-shifts', '0 * * * *', $$select public.close_stale_courier_shifts();$$);

-- ---------------------------------------------------------------------------
-- 6. admin_courier_pilot_kpis — the go/no-go read surface (Faza 5 §8 table).
--    security_invoker: a courier sees only their own row (couriers_self_read
--    + the self-read policies on the two new tables), platform_admin sees all.
-- ---------------------------------------------------------------------------
create or replace view public.admin_courier_pilot_kpis
with (security_invoker = on) as
select
  c.id as courier_id,
  c.full_name,
  c.is_active,
  -- Weekly satisfaction, rolling 4 weeks (target >=4.5, Wolt benchmark 4.57).
  (select round(avg(s.stars)::numeric, 2) from public.courier_satisfaction_surveys s
    where s.courier_id = c.id and s.week_start >= date_trunc('week', now())::date - 28) as satisfaction_avg_4w,
  (select count(*) from public.courier_satisfaction_surveys s
    where s.courier_id = c.id and s.week_start >= date_trunc('week', now())::date - 28) as satisfaction_responses_4w,
  -- Gross earnings per COMPLETED shift, rolling 14 days (target 600-1000 MDL/tura).
  sh.shifts_14d,
  sh.median_gross_per_shift_14d,
  sh.avg_orders_per_shift_14d
from public.couriers c
left join lateral (
  select
    count(*) as shifts_14d,
    round(percentile_cont(0.5) within group (order by earn.gross_mdl)::numeric, 2) as median_gross_per_shift_14d,
    round(avg(earn.orders_count)::numeric, 1) as avg_orders_per_shift_14d
  from public.courier_shifts cs
  cross join lateral (
    select
      count(o.id) as orders_count,
      coalesce(sum(o.delivery_fee_mdl + coalesce(o.tip_mdl, 0)), 0) as gross_mdl
    from public.orders o
    where o.courier_id = cs.courier_id and o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at >= cs.started_at and o.delivered_at < cs.ended_at
  ) earn
  where cs.courier_id = c.id and cs.ended_at is not null and cs.ended_at >= now() - interval '14 days'
) sh on true;

revoke all on public.admin_courier_pilot_kpis from anon;
grant select on public.admin_courier_pilot_kpis to authenticated;
