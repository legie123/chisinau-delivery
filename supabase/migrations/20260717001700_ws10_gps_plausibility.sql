-- WS10 — GPS plausibility / fraud basics: courier teleport detection (research §5.3).
-- Signal only, never enforcement: the location write always succeeds. A BEFORE UPDATE
-- trigger on courier_locations flags physically impossible movement (>150 km/h) into a
-- new fraud_flags table (append-only from the security-definer trigger, admin-read RLS —
-- the delivery_status_events pattern). PostGIS NOT required (haversine); WS3 may swap later.

-- 1. Fraud flags table. Signal store, append-only from triggers.
create table if not exists public.fraud_flags (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.couriers(id) on delete cascade,
  -- open text (not CHECK) so future kinds (dup-device, cash-mismatch) need no migration.
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
comment on table public.fraud_flags is 'WS10: plausibility signals (research §5.3). Log/flag, never enforce. kinds so far: gps_teleport';

create index if not exists fraud_flags_courier_created_idx on public.fraud_flags (courier_id, created_at desc);
create index if not exists fraud_flags_unreviewed_idx on public.fraud_flags (created_at desc) where reviewed_at is null;

alter table public.fraud_flags enable row level security;

-- Admin-only read + review-update. Deliberately NO insert/delete policy for any role —
-- only the security-definer trigger below writes (delivery_status_events pattern).
drop policy if exists "fraud_flags_admin_read" on public.fraud_flags;
create policy "fraud_flags_admin_read" on public.fraud_flags
  for select using (has_role('platform_admin'));
drop policy if exists "fraud_flags_admin_review" on public.fraud_flags;
create policy "fraud_flags_admin_review" on public.fraud_flags
  for update using (has_role('platform_admin')) with check (has_role('platform_admin'));

-- 2. Fix latent bug: courier_locations.updated_at never advanced on the upsert's UPDATE
-- path (default now() applies only on INSERT; no trigger existed). Reuses set_updated_at()
-- from migration 000000. Needed so OLD.updated_at is a real previous-ping timestamp.
drop trigger if exists courier_locations_set_updated_at on public.courier_locations;
create trigger courier_locations_set_updated_at
  before update on public.courier_locations
  for each row execute function public.set_updated_at();

-- 3. Plausibility check. BEFORE UPDATE only: courier_locations is one row per courier
-- (PK courier_id), so the upsert's UPDATE path is exactly "new ping with a previous point
-- available"; the first-ever INSERT has no baseline and is skipped. security definer so the
-- insert into fraud_flags bypasses its (absent) insert policy; search_path pinned per 000800.
create or replace function public.check_gps_plausibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_kmh constant numeric := 150;   -- research §5.3 "instant teleport" threshold
  c_min_km constant numeric := 0.3;    -- ignore GPS jitter / urban-canyon noise
  c_min_s constant numeric := 5;       -- ignore near-simultaneous double-writes
  v_elapsed_s numeric;
  v_dist_km numeric;
  v_speed_kmh numeric;
  v_order_id uuid;
begin
  -- Use now(), not NEW.updated_at, so correctness doesn't depend on the alphabetical
  -- firing order of the two BEFORE UPDATE triggers.
  v_elapsed_s := extract(epoch from (now() - old.updated_at));
  if v_elapsed_s < c_min_s then return new; end if;

  -- Haversine, km (PostGIS deliberately not required for WS10; WS3 may swap later).
  v_dist_km := 6371 * 2 * asin( least(1, sqrt(
      power(sin(radians(new.lat - old.lat) / 2), 2)
      + cos(radians(old.lat)) * cos(radians(new.lat))
        * power(sin(radians(new.lng - old.lng) / 2), 2)
  )));
  if v_dist_km < c_min_km then return new; end if;

  v_speed_kmh := v_dist_km / (v_elapsed_s / 3600.0);
  if v_speed_kmh <= c_max_kmh then return new; end if;

  -- Debounce: one gps_teleport flag per courier per 5 minutes max.
  if exists (
    select 1 from public.fraud_flags
    where courier_id = new.courier_id and kind = 'gps_teleport'
      and created_at > now() - interval '5 minutes'
  ) then return new; end if;

  -- Context: the courier's in-flight order, if any (nullable — signal still useful offline).
  select id into v_order_id from public.orders
  where courier_id = new.courier_id
    and status in ('courier_assigned', 'picked_up', 'en_route')
  limit 1;

  insert into public.fraud_flags (courier_id, kind, detail)
  values (new.courier_id, 'gps_teleport', jsonb_build_object(
    'from', jsonb_build_object('lat', old.lat, 'lng', old.lng, 'at', old.updated_at),
    'to',   jsonb_build_object('lat', new.lat, 'lng', new.lng),
    'elapsed_s', round(v_elapsed_s),
    'distance_km', round(v_dist_km, 2),
    'speed_kmh', round(v_speed_kmh),
    'order_id', v_order_id
  ));

  return new; -- ALWAYS: signal, never enforcement — the location write goes through.
end;
$$;

revoke execute on function public.check_gps_plausibility() from public, anon, authenticated;

drop trigger if exists courier_locations_teleport_check on public.courier_locations;
create trigger courier_locations_teleport_check
  before update on public.courier_locations
  for each row execute function public.check_gps_plausibility();
