-- Order 5 — PICKUP/DROP-OFF GEOFENCE HINT. A discreet client-side proximity
-- chip ("~120 m până la restaurant") plus an append-only log of the moments a
-- courier presses "arrived" while within 150m of the relevant point. This is
-- a SOFT HINT ONLY — never delivery proof, never coupled to
-- advance_delivery_status (no trigger, no transition guard reads it). It
-- exists purely for later ops/fraud signal (e.g. "arrived" presses that are
-- suspiciously far from the restaurant/address), same spirit as WS10's
-- fraud_flags: observe, never block.

create table public.geofence_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  courier_id uuid not null references public.couriers(id) on delete cascade,
  kind text not null check (kind in ('pickup', 'dropoff')),
  lat numeric(9, 6) not null,
  lng numeric(9, 6) not null,
  dist_m numeric not null check (dist_m >= 0),
  created_at timestamptz not null default now()
);

create index geofence_events_order_idx on public.geofence_events(order_id, created_at);
create index geofence_events_courier_idx on public.geofence_events(courier_id, created_at);

alter table public.geofence_events enable row level security;

-- Courier-own-read + admin-read. NO client write policies at all — this table
-- is precise GPS PII (same category as courier_locations) and append-only by
-- design; every row is written exclusively by record_geofence_event below.
create policy geofence_events_self_read on public.geofence_events
  for select using (courier_id = public.current_courier_id());
create policy geofence_events_admin_read on public.geofence_events
  for select using (has_role('platform_admin'));

revoke all on public.geofence_events from anon;
grant select on public.geofence_events to authenticated;

-- record_geofence_event — the assigned courier only, auth checked inside
-- (security definer bypasses RLS, so this check IS the boundary, not the
-- missing write policies above). Reuses haversine_km (20260717001600) to
-- recompute the distance server-side rather than trusting the client's
-- p_dist_m for the row that gets stored — the client value only decided
-- whether to fire the call (its own <=150m gate), the stored dist_m is always
-- the server's own number against the order's pickup/dropoff point.
-- Deliberately does NOT touch orders/advance_delivery_status/dispatch in any
-- way — a courier who never triggers this still delivers normally.
create or replace function public.record_geofence_event(
  p_order_id uuid,
  p_kind text,
  p_lat numeric,
  p_lng numeric
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_order public.orders%rowtype;
  v_courier_id uuid;
  v_target_lat numeric;
  v_target_lng numeric;
  v_dist_m numeric;
begin
  if p_kind not in ('pickup', 'dropoff') then
    raise exception 'invalid kind %', p_kind;
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;

  v_courier_id := public.current_courier_id();
  if v_courier_id is null or v_order.courier_id is distinct from v_courier_id then
    raise exception 'not authorized';
  end if;

  if p_kind = 'pickup' then
    select r.lat, r.lng into v_target_lat, v_target_lng
    from public.restaurants r where r.id = v_order.restaurant_id;
  else
    select a.lat, a.lng into v_target_lat, v_target_lng
    from public.addresses a where a.id = v_order.delivery_address_id;
  end if;

  -- No known target point (missing geocode) — still record the courier's
  -- position with a null-safe large distance rather than silently dropping
  -- the event; a hint with an unknown target is a data-quality signal, not a
  -- reason to fail the whole call.
  v_dist_m := case
    when v_target_lat is null or v_target_lng is null then null
    else public.haversine_km(p_lat, p_lng, v_target_lat, v_target_lng) * 1000
  end;

  insert into public.geofence_events (order_id, courier_id, kind, lat, lng, dist_m)
  values (p_order_id, v_courier_id, p_kind, p_lat, p_lng, coalesce(v_dist_m, 999999));
end;
$function$;

revoke all on function public.record_geofence_event(uuid, text, numeric, numeric) from public, anon;
grant execute on function public.record_geofence_event(uuid, text, numeric, numeric) to authenticated;

-- Append-only enforcement — a real trigger (not just RLS), exactly like
-- courier_cash_movements' guard_cash_movements_append_only: RLS alone doesn't
-- stop a superuser/service-role connection, and we still need one below.
-- UPDATE is blocked unconditionally (there is never a legitimate correction —
-- a wrong reading is just a new row). DELETE is blocked EXCEPT for rows past
-- the 2-year retention window, so purge_expired_pii's bulk delete keeps
-- working while any other delete (client, admin, accidental) still raises.
create or replace function public.block_geofence_events_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.created_at < now() - interval '2 years' then
      return old; -- purge_expired_pii deleting an expired row — allowed
    end if;
    raise exception 'geofence_events is append-only (delete blocked within the 2-year retention window)';
  end if;
  raise exception 'geofence_events is append-only';
end;
$$;

create trigger geofence_events_no_update
  before update on public.geofence_events
  for each row execute function public.block_geofence_events_mutation();

create trigger geofence_events_no_delete
  before delete on public.geofence_events
  for each row execute function public.block_geofence_events_mutation();

-- MANDATORY (phoenix): geofence_events is precise GPS PII, structurally
-- identical to courier_locations — fold its 2-year purge into the SAME
-- purge_expired_pii cron rather than a parallel job. Recreated verbatim from
-- the CURRENT DB body (20260727000200_gdpr_retention_align.sql), adding only
-- the new delete at the top alongside the courier_locations purge.
create or replace function public.purge_expired_pii()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0. Geofence hint events (precise GPS, same retention class as courier
  --    GPS below) — 2 years.
  delete from public.geofence_events where created_at < now() - interval '2 years';

  -- 1. Courier GPS last-known position — 2 years (Bolt's published window).
  delete from public.courier_locations where updated_at < now() - interval '2 years';

  -- 2. Address access details (intercom code + free-text notes) — redact for
  --    customers with no order in the last year.
  update public.addresses a
    set intercom_code = null, notes = null
  where (a.intercom_code is not null or a.notes is not null)
    and not exists (
      select 1 from public.orders o
      where o.customer_id = a.customer_id and o.created_at > now() - interval '365 days'
    );

  -- 3. Dormant customer accounts — had orders, but none in 3 years → anonymize the
  --    personal data. Order/rating/payout rows are PRESERVED (10-year fiscal
  --    retention); only name/phone/address are scrubbed.
  update public.profiles p
    set full_name = 'Utilizator șters', phone = null
  where p.role = 'customer'
    and exists (select 1 from public.orders o where o.customer_id = p.id)
    and not exists (
      select 1 from public.orders o
      where o.customer_id = p.id and o.created_at > now() - interval '3 years'
    );

  update public.addresses a
    set street_address = 'Adresă ștearsă', label = null, sector = null, building = null,
        apartment = null, entrance = null, floor = null, intercom_code = null, notes = null,
        lat = null, lng = null
  where a.customer_id in (
    select p.id from public.profiles p
    where p.role = 'customer'
      and exists (select 1 from public.orders o where o.customer_id = p.id)
      and not exists (
        select 1 from public.orders o
        where o.customer_id = p.id and o.created_at > now() - interval '3 years'
      )
  );

  -- Old customer order notes may carry personal instructions — scrub past 3 years.
  update public.orders set notes = null
  where notes is not null and created_at < now() - interval '3 years';
end;
$$;

revoke execute on function public.purge_expired_pii() from public, anon, authenticated;
