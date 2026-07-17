-- WS3 — Real geo: PostGIS nearby-search + courier location plausibility + dispatch distance
-- (research §2.4, §4.2). Additive. Numeric lat/lng stay the writable columns (existing
-- insert/upsert paths untouched); geography columns are GENERATED from them, so PostGIS is
-- invisible to clients. Reconciled with shipped WS2 (assign_courier grafted, not overwritten)
-- and WS10 (set_updated_at trigger already exists; this adds a complementary is_plausible guard).

-- 1. PostGIS into the Supabase-managed extensions schema (never public).
create extension if not exists postgis with schema extensions;

-- 2. restaurants: lat/lng already exist (WS2). Add Moldova bounds (NOT VALID so a stray
--    row can't fail the migration) + generated geography + partial GiST for nearby-search.
alter table public.restaurants drop constraint if exists restaurants_lat_bounds;
alter table public.restaurants add constraint restaurants_lat_bounds check (lat is null or lat between 45.4 and 48.5) not valid;
alter table public.restaurants drop constraint if exists restaurants_lng_bounds;
alter table public.restaurants add constraint restaurants_lng_bounds check (lng is null or lng between 26.6 and 30.2) not valid;
alter table public.restaurants
  add column if not exists geo extensions.geography(point, 4326)
    generated always as (
      case when lat is not null and lng is not null
        then extensions.st_setsrid(extensions.st_makepoint(lng::float8, lat::float8), 4326)::extensions.geography
      end
    ) stored;
create index if not exists restaurants_geo_gix on public.restaurants using gist (geo) where is_active = true;

-- 3. addresses: generated geography (dispatch distance / future ETA) + bounds NOT VALID.
alter table public.addresses drop constraint if exists addresses_lat_bounds;
alter table public.addresses add constraint addresses_lat_bounds check (lat is null or lat between 45.4 and 48.5) not valid;
alter table public.addresses drop constraint if exists addresses_lng_bounds;
alter table public.addresses add constraint addresses_lng_bounds check (lng is null or lng between 26.6 and 30.2) not valid;
alter table public.addresses
  add column if not exists geo extensions.geography(point, 4326)
    generated always as (
      case when lat is not null and lng is not null
        then extensions.st_setsrid(extensions.st_makepoint(lng::float8, lat::float8), 4326)::extensions.geography
      end
    ) stored;

-- 4. courier_locations: geography + accuracy + plausibility flag + GiST.
alter table public.courier_locations
  add column if not exists accuracy_m numeric(7, 1),
  add column if not exists is_plausible boolean not null default true,
  add column if not exists geo extensions.geography(point, 4326)
    generated always as (
      extensions.st_setsrid(extensions.st_makepoint(lng::float8, lat::float8), 4326)::extensions.geography
    ) stored;
create index if not exists courier_locations_geo_gix on public.courier_locations using gist (geo);
-- NOTE: set_updated_at trigger already added by WS10 (20260717001700) — not re-added.

-- 4b. Plausibility guard: hard-reject coords outside the Moldova box; soft-flag teleports
--     (>150 km/h implied speed) into is_plausible. Complements WS10's fraud_flags trigger
--     (which logs the same teleport as an admin signal). BEFORE trigger: NEW.geo not yet
--     computed, so build points from lat/lng. Name sorts before set_updated_at/teleport_check.
create or replace function public.courier_location_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_speed_kmh double precision;
begin
  if new.lat not between 45.4 and 48.5 or new.lng not between 26.6 and 30.2 then
    raise exception 'coordinates outside service area';
  end if;
  new.is_plausible := true;
  if tg_op = 'UPDATE' then
    v_speed_kmh := (extensions.st_distance(
        extensions.st_setsrid(extensions.st_makepoint(new.lng::float8, new.lat::float8), 4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(old.lng::float8, old.lat::float8), 4326)::extensions.geography
      ) / 1000.0)
      / greatest(extract(epoch from (now() - old.updated_at)) / 3600.0, 1.0 / 3600.0);
    if v_speed_kmh > 150 then new.is_plausible := false; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists courier_locations_guard on public.courier_locations;
create trigger courier_locations_guard
  before insert or update on public.courier_locations
  for each row execute function public.courier_location_guard();

-- 5. nearby_restaurants — PUBLIC browse RPC. SECURITY INVOKER (default): restaurants RLS
--    (restaurants_public_read) stays the boundary. Inputs clamped.
create or replace function public.nearby_restaurants(
  p_lat double precision, p_lng double precision,
  p_radius_km double precision default 10, p_limit int default 50
)
returns table (
  id uuid, slug text, name text, cuisine_type text, description text,
  logo_url text, cover_photo_url text, address text, sector text, phone text,
  is_active boolean, accepting_orders boolean, accepts_catering boolean,
  delivery_fee_mdl numeric, min_order_amount_mdl numeric,
  catering_min_amount_mdl numeric, avg_prep_minutes int,
  lat numeric, lng numeric, distance_m double precision
)
language sql stable
set search_path = public, extensions
as $$
  select r.id, r.slug, r.name, r.cuisine_type, r.description, r.logo_url,
         r.cover_photo_url, r.address, r.sector, r.phone, r.is_active,
         r.accepting_orders, r.accepts_catering, r.delivery_fee_mdl,
         r.min_order_amount_mdl, r.catering_min_amount_mdl, r.avg_prep_minutes,
         r.lat, r.lng,
         extensions.st_distance(r.geo, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography) as distance_m
  from public.restaurants r
  where r.is_active
    and r.geo is not null
    and extensions.st_dwithin(r.geo,
          extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
          least(greatest(p_radius_km, 0.5), 30) * 1000)
  order by distance_m
  limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.nearby_restaurants(double precision, double precision, double precision, int) to anon, authenticated;

-- 6. courier_dispatch_distance_m — internal helper (WS2 scoring + assign_courier guard).
--    NULL when courier has no FRESH (<2 min) plausible fix or restaurant not geocoded →
--    callers fail open. TTL = 2 min ≈ 2.5 missed 45s beats.
create or replace function public.courier_dispatch_distance_m(p_courier_id uuid, p_restaurant_id uuid)
returns double precision
language sql stable security definer
set search_path = public, extensions
as $$
  select extensions.st_distance(cl.geo, r.geo)
  from public.courier_locations cl
  join public.restaurants r on r.id = p_restaurant_id and r.geo is not null
  where cl.courier_id = p_courier_id
    and cl.is_plausible
    and cl.updated_at > now() - interval '2 minutes';
$$;
revoke execute on function public.courier_dispatch_distance_m(uuid, uuid) from public, anon, authenticated;

-- 7. nearby_available_couriers — WS2's expanding-radius geo-query (internal, location privacy).
create or replace function public.nearby_available_couriers(
  p_restaurant_id uuid, p_radius_km double precision default 5, p_limit int default 20
)
returns table (courier_id uuid, distance_m double precision, located_at timestamptz)
language sql stable security definer
set search_path = public, extensions
as $$
  select cl.courier_id, extensions.st_distance(cl.geo, r.geo), cl.updated_at
  from public.courier_locations cl
  join public.couriers c on c.id = cl.courier_id and c.is_active and c.status = 'online'
  join public.restaurants r on r.id = p_restaurant_id and r.geo is not null
  where cl.is_plausible
    and cl.updated_at > now() - interval '2 minutes'
    and extensions.st_dwithin(cl.geo, r.geo, least(greatest(p_radius_km, 0.5), 20) * 1000)
  order by 2
  limit least(greatest(p_limit, 1), 50);
$$;
revoke execute on function public.nearby_available_couriers(uuid, double precision, int) from public, anon, authenticated;

-- 8. assign_courier — LIVE WS2 body (courier_has_capacity + dispatch_offers cancellation)
--    VERBATIM + ONE additive fail-open geo guard after the capacity check. NULL > 15000 is
--    NULL → couriers without a fresh GPS lock are never blocked.
create or replace function public.assign_courier(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_courier_id uuid;
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.courier_id = v_courier_id and v_order.status = 'courier_assigned' then return; end if;

  if not public.courier_has_capacity(v_courier_id) then
    raise exception 'you already have an active delivery';
  end if;

  -- WS3 additive guard: dispatch-distance plausibility, fail-open on no fresh fix.
  if public.courier_dispatch_distance_m(v_courier_id, v_order.restaurant_id) > 15000 then
    raise exception 'too far from restaurant to claim this order';
  end if;

  if v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    raise exception 'order not available for assignment';
  end if;

  update public.orders set status = 'courier_assigned', courier_id = v_courier_id where id = p_order_id;
  update public.couriers set status = 'on_delivery' where id = v_courier_id;
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where order_id = p_order_id and status = 'offered'; -- WS2: kill live offer

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'courier_assigned', 'courier', auth.uid());
end;
$$;
