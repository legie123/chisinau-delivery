-- Master-audit §2.1 — versioned courier tariff + change notification.
--
-- "Grevele nu sunt despre nivelul plății, sunt despre schimbarea NEANUNȚATĂ a
-- multiplicatorului" (Vilnius 2020, Lituania 2025, Oradea 2025). The fix, per the
-- audit: a versioned tariff table + a notification on change. Before this, the rates
-- lived in a single mutable platform_settings row — an admin could silently change
-- the courier commission and every unsettled earning would recompute, no record, no
-- warning.
--
-- Design: pricing_config is the versioned, IMMUTABLE history + the announce trigger;
-- platform_settings stays the "current active" cache the money functions already read
-- (no money-critical code recreated). The rates change ONLY through set_pricing_config,
-- which appends a new immutable version AND announces it to couriers via the outbox.

create table if not exists public.pricing_config (
  id uuid primary key default gen_random_uuid(),
  effective_from timestamptz not null default now(),
  courier_commission_pct numeric(5,2) not null check (courier_commission_pct >= 0 and courier_commission_pct <= 100),
  restaurant_commission_pct numeric(5,2) not null check (restaurant_commission_pct >= 0 and restaurant_commission_pct <= 100),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.pricing_config enable row level security;
-- Transparency: any authenticated user (courier included) may READ the tariff.
-- No insert/update/delete policies → only the security-definer set_pricing_config writes.
drop policy if exists pricing_config_read on public.pricing_config;
create policy pricing_config_read on public.pricing_config for select to authenticated using (true);

-- Seed v1 = the current pilot rates, effective before every existing order so all
-- historical payouts map to it unchanged.
insert into public.pricing_config (effective_from, courier_commission_pct, restaurant_commission_pct, note)
select '2026-01-01T00:00:00Z', s.courier_commission_pct, s.restaurant_commission_pct, 'Tarif inițial pilot'
from public.platform_settings s
where not exists (select 1 from public.pricing_config);

-- The config effective right now (latest effective_from <= now()).
create or replace function public.current_pricing_config()
returns public.pricing_config
language sql stable security definer set search_path = public
as $$
  select * from public.pricing_config where effective_from <= now() order by effective_from desc limit 1;
$$;
grant execute on function public.current_pricing_config() to authenticated;

-- Change the tariff: append a NEW immutable version, sync the active cache the money
-- functions read, and ANNOUNCE it to every active courier. effective_from may be in
-- the future so couriers are warned BEFORE it bites.
create or replace function public.set_pricing_config(
  p_courier_pct numeric, p_restaurant_pct numeric, p_effective_from timestamptz, p_note text default null
)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare v_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  insert into public.pricing_config (effective_from, courier_commission_pct, restaurant_commission_pct, note, created_by)
  values (p_effective_from, p_courier_pct, p_restaurant_pct, p_note, auth.uid())
  returning id into v_id;

  -- Sync the active-rate cache the money functions (admin_generate_payouts, clawback)
  -- already read. platform_settings is now driven only through this RPC.
  update public.platform_settings
    set courier_commission_pct = p_courier_pct, restaurant_commission_pct = p_restaurant_pct;

  -- Announce to couriers — the whole point (no silent change).
  insert into public.notification_outbox (user_id, title, body, url, tag)
  select c.user_id, 'Actualizare tarife',
         format('Comisionul curier devine %s%% de la %s. Bacșișul rămâne 100%% al tău.',
                trim(to_char(p_courier_pct, 'FM990.99')), p_effective_from::date),
         '/earnings', 'pricing'
  from public.couriers c where c.is_active;

  return v_id;
end;
$$;
revoke execute on function public.set_pricing_config(numeric, numeric, timestamptz, text) from public, anon;
grant execute on function public.set_pricing_config(numeric, numeric, timestamptz, text) to authenticated;

-- A published tariff version is immutable — a change is a NEW row, never an edit.
create or replace function public.guard_pricing_config_immutable()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'pricing_config este imutabil — o schimbare de tarif se face cu o versiune nouă (set_pricing_config)';
end;
$$;
drop trigger if exists guard_pricing_config_immutable on public.pricing_config;
create trigger guard_pricing_config_immutable
  before update or delete on public.pricing_config
  for each row execute function public.guard_pricing_config_immutable();
