-- Master-audit Faza 3 #3 — externalize dispatch scoring weights (alpha0, alpha1,
-- alpha2) so ops can retune the courier-matching formula without a deploy.
-- ("Externalizeaza ponderile α0, α1, α2 in config" — EasyChair w5L8.)
--
-- dispatch_order() (WS2, migration 20260717001600, refined 20260717002500 for
-- the is_plausible GPS filter) scores each idle courier candidate as:
--   score = (dist_km / speed_kmh * 60) * alpha0  +  (1 - acceptance_rate) * alpha1
-- alpha0/alpha1 were hardcoded (1 and 10) since day one. This migration mirrors
-- the pricing_config pattern (20260727000400): a versioned, IMMUTABLE history
-- table + a security-definer setter, read by an internal "current" getter.
--
-- Deliberate DIFFERENCE from pricing_config: this is an internal ops tuning
-- knob, not a courier-facing commercial term — no notification_outbox announce,
-- no open "any authenticated user may read" policy. Only platform_admin may
-- read or write (courier-facing transparency about dispatch is Faza 3 #6's
-- separate public "how it works" page — qualitative, not the raw weights).
--
-- alpha2 is reserved: seeded at 0, stored, but NOT YET consumed by
-- dispatch_order's formula. The audit's own Faza 4 (NSGA-II multi-objective
-- tuning of the 3 alphas, once the SimPy simulator is validated) is the first
-- planned consumer of a third term. The column exists now so that future work
-- is a formula change against an already-versioned table, not another
-- migration.

create table if not exists public.dispatch_scoring_config (
  id uuid primary key default gen_random_uuid(),
  effective_from timestamptz not null default now(),
  alpha0 numeric(6, 3) not null default 1.0 check (alpha0 >= 0),  -- weight on ETA-to-restaurant (minutes)
  alpha1 numeric(6, 3) not null default 10.0 check (alpha1 >= 0), -- weight on (1 - 14d acceptance rate)
  alpha2 numeric(6, 3) not null default 0 check (alpha2 >= 0),   -- reserved, unused until Faza 4
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.dispatch_scoring_config enable row level security;
-- Ops-internal tuning knob, NOT a courier-facing tariff — admin-only read,
-- unlike pricing_config's deliberately open "authenticated" read policy.
drop policy if exists dispatch_scoring_config_admin on public.dispatch_scoring_config;
create policy dispatch_scoring_config_admin on public.dispatch_scoring_config for select
  using (has_role('platform_admin'));

-- Seed v1 = the formula hardcoded in dispatch_order since WS2, so shipping this
-- migration never silently changes production dispatch behavior.
insert into public.dispatch_scoring_config (effective_from, alpha0, alpha1, alpha2, note)
select '2026-01-01T00:00:00Z', 1.0, 10.0, 0.0,
       'Ponderi initiale — echivalentul formulei hardcodate WS2/dispatch_plausible'
where not exists (select 1 from public.dispatch_scoring_config);

-- The weights effective right now (latest effective_from <= now()). INTERNAL
-- ONLY: called from dispatch_order (security definer); revoked from every
-- client role, never called directly from the app.
create or replace function public.current_dispatch_scoring_config()
returns public.dispatch_scoring_config
language sql stable security definer set search_path = public
as $$
  select * from public.dispatch_scoring_config where effective_from <= now() order by effective_from desc limit 1;
$$;
revoke execute on function public.current_dispatch_scoring_config() from public, anon, authenticated;

-- Retune: append a NEW immutable version. No deploy needed — the very next
-- dispatch_order() call reads it. effective_from may be in the future to
-- schedule a change ahead of time.
create or replace function public.set_dispatch_scoring_config(
  p_alpha0 numeric, p_alpha1 numeric, p_alpha2 numeric default 0,
  p_effective_from timestamptz default now(), p_note text default null
)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare v_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  if p_alpha0 < 0 or p_alpha1 < 0 or p_alpha2 < 0 then raise exception 'ponderile trebuie sa fie >= 0'; end if;

  insert into public.dispatch_scoring_config (effective_from, alpha0, alpha1, alpha2, note, created_by)
  values (p_effective_from, p_alpha0, p_alpha1, p_alpha2, p_note, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
revoke execute on function public.set_dispatch_scoring_config(numeric, numeric, numeric, timestamptz, text) from public, anon;
grant execute on function public.set_dispatch_scoring_config(numeric, numeric, numeric, timestamptz, text) to authenticated;

-- Admin-readable getter for a future ops dashboard — role-checked internally,
-- unlike current_dispatch_scoring_config which is revoked outright.
create or replace function public.admin_get_dispatch_scoring_config()
returns public.dispatch_scoring_config
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  return public.current_dispatch_scoring_config();
end;
$$;
revoke execute on function public.admin_get_dispatch_scoring_config() from public, anon;
grant execute on function public.admin_get_dispatch_scoring_config() to authenticated;

-- A published weight version is immutable — a retune is a NEW row, never an edit.
create or replace function public.guard_dispatch_scoring_config_immutable()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'dispatch_scoring_config este imutabil — o schimbare de ponderi se face cu o versiune noua (set_dispatch_scoring_config)';
end;
$$;
drop trigger if exists guard_dispatch_scoring_config_immutable on public.dispatch_scoring_config;
create trigger guard_dispatch_scoring_config_immutable
  before update or delete on public.dispatch_scoring_config
  for each row execute function public.guard_dispatch_scoring_config_immutable();

-- Rewire dispatch_order to read alpha0/alpha1 from the versioned config instead
-- of the hardcoded 1x / 10x coefficients. Everything else is the exact
-- WS2/dispatch_plausible body: same is_plausible GPS filter, same candidate
-- query, same wave/capacity/lock guards, same revoke.
create or replace function public.dispatch_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_cand record;
  v_wave int;
  v_offer_id uuid;
  v_cfg public.dispatch_scoring_config;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    return null;
  end if;
  if exists (select 1 from public.dispatch_offers where order_id = p_order_id and status = 'offered') then
    return null;
  end if;

  select coalesce(max(wave), 0) + 1 into v_wave from public.dispatch_offers where order_id = p_order_id;
  if v_wave > 5 then
    return null;
  end if;

  select * into v_cfg from public.current_dispatch_scoring_config();

  select c.id as courier_id, d.dist_km,
         round(d.dist_km / v.speed_kmh * 60 * v_cfg.alpha0 + (1 - acc.rate) * v_cfg.alpha1, 2) as score
  into v_cand
  from public.couriers c
  join public.restaurants r on r.id = v_order.restaurant_id
  left join public.courier_locations cl
    on cl.courier_id = c.id and cl.updated_at > now() - interval '10 minutes' and cl.is_plausible
  cross join lateral (
    select case c.vehicle_type
      when 'bike' then 12 when 'e_bike' then 18 when 'scooter' then 25
      when 'car' then 22 else 5 end::numeric as speed_kmh
  ) v
  cross join lateral (
    select coalesce(public.haversine_km(cl.lat, cl.lng, r.lat, r.lng), 6.0) as dist_km
  ) d
  left join lateral (
    select case when count(*) = 0 then 1.0
      else avg((o2.status = 'accepted')::int)::numeric end as rate
    from public.dispatch_offers o2
    where o2.courier_id = c.id
      and o2.status in ('accepted', 'declined', 'expired')
      and o2.created_at > now() - interval '14 days'
  ) acc on true
  where c.status = 'online' and c.is_active
    and public.courier_has_capacity(c.id)
    and not exists (select 1 from public.dispatch_offers lo
                    where lo.courier_id = c.id and lo.status = 'offered')
    and not exists (select 1 from public.dispatch_offers po
                    where po.courier_id = c.id and po.order_id = p_order_id)
  order by score asc
  limit 1;

  if v_cand.courier_id is null then
    return null;
  end if;

  insert into public.dispatch_offers (order_id, courier_id, wave, score, distance_km, expires_at)
  values (p_order_id, v_cand.courier_id, v_wave, v_cand.score, v_cand.dist_km, now() + interval '30 seconds')
  returning id into v_offer_id;
  return v_offer_id;
end;
$$;
revoke execute on function public.dispatch_order(uuid) from public, anon, authenticated;
