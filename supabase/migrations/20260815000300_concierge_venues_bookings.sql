-- Dragons Delivery Chișinău devine CONCIERGE (2026-08-15).
--
-- Povestea se lărgește: nu doar mâncare livrată, ci un singur loc din care un
-- client — mai ales unul corporativ — leagă tot ce ține de o întâlnire bună:
-- restaurantul high-end sau sushi bar-ul, spa-ul, lounge-ul de wellness și sala
-- de business. Cazul care unește totul, și care se sprijină pe pârghia
-- economică găsită la auditul de creștere (catering B2B = ~1.800 MDL comision
-- pe comandă, firme care repetă săptămânal):
--
--   „Brainstorming, 8 persoane, marți la 14:00 — sală, prânz, apoi o oră de
--    wellness pentru echipă."
--
-- Alegere de arhitectură: locațiile NU primesc tabel nou. `restaurants` are
-- deja nume, slug, adresă, coordonate, fotografii, program, rating, onboarding
-- și un întreg strat RLS testat; un tabel paralel ar duplica toate astea și ar
-- dubla fiecare politică. Se adaugă doar `venue_type` — ortogonal pe
-- `cuisine_type`, care rămâne despre mâncare.
--
-- Ce e cu adevărat nou e a doua formă de tranzacție: până acum totul era
-- „comandă care se livrează". Un spa sau o sală se REZERVĂ, iar clientul vine
-- acolo. De aici `venue_bookings`, cu același ritm ca la catering (cerere →
-- ofertă → confirmare), fiindcă prețul unei săli sau al unui pachet wellness
-- se stabilește de partener, nu de un preț de raft.

alter table public.restaurants
  add column if not exists venue_type text not null default 'restaurant';

alter table public.restaurants
  drop constraint if exists restaurants_venue_type_check,
  add constraint restaurants_venue_type_check check (
    venue_type in ('restaurant', 'sushi_bar', 'spa', 'wellness_lounge', 'business_lounge')
  );

comment on column public.restaurants.venue_type is
  'Tipul locației în rețeaua concierge. „restaurant" acoperă tot ce livrează mâncare (comportament neschimbat); celelalte tipuri se rezervă prin venue_bookings.';

create table if not exists public.venue_bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.restaurants(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  party_size int not null check (party_size > 0 and party_size <= 500),
  purpose text not null check (purpose in ('meeting', 'dining', 'wellness', 'event')),
  status text not null default 'requested'
    check (status in ('requested', 'quoted', 'confirmed', 'declined', 'cancelled', 'completed')),
  notes text,
  contact_person text,
  contact_phone text,
  quoted_price_mdl numeric(10, 2) check (quoted_price_mdl is null or quoted_price_mdl >= 0),
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venue_bookings_window_check check (ends_at > starts_at)
);

create index if not exists venue_bookings_venue_time_idx
  on public.venue_bookings (venue_id, starts_at desc);
create index if not exists venue_bookings_customer_idx
  on public.venue_bookings (customer_id, starts_at desc);

alter table public.venue_bookings enable row level security;

-- Aceleași granițe ca peste tot: clientul își vede rezervările, personalul
-- locației le vede pe ale locației lui, adminul le vede pe toate. Scrierea se
-- face DOAR prin RPC-uri (security definer), ca la comenzi.
drop policy if exists venue_bookings_customer_read on public.venue_bookings;
create policy venue_bookings_customer_read on public.venue_bookings
  for select to authenticated
  using (customer_id = (select auth.uid()));

drop policy if exists venue_bookings_venue_read on public.venue_bookings;
create policy venue_bookings_venue_read on public.venue_bookings
  for select to authenticated
  using (public.has_restaurant_access(venue_id));

drop policy if exists venue_bookings_admin_read on public.venue_bookings;
create policy venue_bookings_admin_read on public.venue_bookings
  for select to authenticated
  using (public.has_role('platform_admin'));

grant select on public.venue_bookings to authenticated;

-- ---------------------------------------------------------------------------
-- Ciclul rezervării, RPC-only (fără scriere directă din client)
-- ---------------------------------------------------------------------------

create or replace function public.request_venue_booking(
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_party_size int,
  p_purpose text,
  p_contact_person text,
  p_contact_phone text,
  p_notes text default null
)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_id uuid;
  v_venue public.restaurants%rowtype;
  v_staff record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_venue from public.restaurants where id = p_venue_id and is_active;
  if not found then raise exception 'locația nu este disponibilă'; end if;

  if p_starts_at <= now() then
    raise exception 'rezervarea trebuie să înceapă în viitor';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'intervalul rezervării este invalid';
  end if;
  if btrim(coalesce(p_contact_person, '')) = '' or btrim(coalesce(p_contact_phone, '')) = '' then
    raise exception 'persoana și telefonul de contact sunt obligatorii';
  end if;

  insert into public.venue_bookings (venue_id, customer_id, starts_at, ends_at, party_size,
                                     purpose, contact_person, contact_phone, notes)
  values (p_venue_id, auth.uid(), p_starts_at, p_ends_at, p_party_size, p_purpose,
          btrim(p_contact_person), btrim(p_contact_phone), nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;

  -- Anunță personalul locației: o cerere pe care n-o vede nimeni nu e o cerere.
  for v_staff in select user_id from public.restaurant_staff where restaurant_id = p_venue_id loop
    insert into public.notification_outbox (user_id, title, body, url, tag)
    values (v_staff.user_id, 'Cerere de rezervare',
            format('%s persoane, %s', p_party_size,
                   to_char(p_starts_at at time zone 'Europe/Chisinau', 'DD.MM HH24:MI')),
            '/restaurant/rezervari', 'booking:' || v_id);
  end loop;

  return v_id;
end;
$$;

create or replace function public.quote_venue_booking(p_booking_id uuid, p_price_mdl numeric)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare v_b public.venue_bookings%rowtype;
begin
  select * into v_b from public.venue_bookings where id = p_booking_id for update;
  if not found then raise exception 'rezervare inexistentă'; end if;
  if not public.has_restaurant_access(v_b.venue_id) then raise exception 'not authorized'; end if;
  if v_b.status not in ('requested', 'quoted') then
    raise exception 'rezervarea nu mai poate primi ofertă (stare: %)', v_b.status;
  end if;
  if p_price_mdl is null or p_price_mdl < 0 then raise exception 'preț invalid'; end if;

  update public.venue_bookings
  set quoted_price_mdl = p_price_mdl, status = 'quoted', updated_at = now()
  where id = p_booking_id;

  insert into public.notification_outbox (user_id, title, body, url, tag)
  values (v_b.customer_id, 'Ofertă pentru rezervare',
          format('%s MDL — confirmă ca să blochezi intervalul.', p_price_mdl),
          '/concierge/rezervari', 'booking:' || p_booking_id);
end;
$$;

create or replace function public.confirm_venue_booking(p_booking_id uuid)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_b public.venue_bookings%rowtype;
  v_staff record;
begin
  select * into v_b from public.venue_bookings where id = p_booking_id for update;
  if not found then raise exception 'rezervare inexistentă'; end if;
  if v_b.customer_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_b.status <> 'quoted' then
    raise exception 'doar o rezervare cu ofertă poate fi confirmată (stare: %)', v_b.status;
  end if;

  update public.venue_bookings set status = 'confirmed', updated_at = now() where id = p_booking_id;

  for v_staff in select user_id from public.restaurant_staff where restaurant_id = v_b.venue_id loop
    insert into public.notification_outbox (user_id, title, body, url, tag)
    values (v_staff.user_id, 'Rezervare confirmată',
            format('%s persoane, %s', v_b.party_size,
                   to_char(v_b.starts_at at time zone 'Europe/Chisinau', 'DD.MM HH24:MI')),
            '/restaurant/rezervari', 'booking:' || p_booking_id);
  end loop;
end;
$$;

create or replace function public.decline_venue_booking(p_booking_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare v_b public.venue_bookings%rowtype;
begin
  select * into v_b from public.venue_bookings where id = p_booking_id for update;
  if not found then raise exception 'rezervare inexistentă'; end if;
  if not public.has_restaurant_access(v_b.venue_id) then raise exception 'not authorized'; end if;
  if v_b.status in ('cancelled', 'declined', 'completed') then
    raise exception 'rezervarea e deja închisă (stare: %)', v_b.status;
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'motivul refuzului e obligatoriu'; end if;

  update public.venue_bookings
  set status = 'declined', decline_reason = btrim(p_reason), updated_at = now()
  where id = p_booking_id;

  -- Clientul primește motivul, nu doar un „nu" — la fel ca la anularea din restaurant.
  insert into public.notification_outbox (user_id, title, body, url, tag)
  values (v_b.customer_id, 'Rezervare refuzată', btrim(p_reason), '/concierge/rezervari',
          'booking:' || p_booking_id);
end;
$$;

create or replace function public.cancel_venue_booking(p_booking_id uuid)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_b public.venue_bookings%rowtype;
  v_staff record;
begin
  select * into v_b from public.venue_bookings where id = p_booking_id for update;
  if not found then raise exception 'rezervare inexistentă'; end if;
  if v_b.customer_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_b.status in ('cancelled', 'declined', 'completed') then
    raise exception 'rezervarea e deja închisă (stare: %)', v_b.status;
  end if;

  update public.venue_bookings set status = 'cancelled', updated_at = now() where id = p_booking_id;

  for v_staff in select user_id from public.restaurant_staff where restaurant_id = v_b.venue_id loop
    insert into public.notification_outbox (user_id, title, body, url, tag)
    values (v_staff.user_id, 'Rezervare anulată de client',
            to_char(v_b.starts_at at time zone 'Europe/Chisinau', 'DD.MM HH24:MI'),
            '/restaurant/rezervari', 'booking:' || p_booking_id);
  end loop;
end;
$$;

revoke execute on function public.request_venue_booking(uuid, timestamptz, timestamptz, int, text, text, text, text) from public, anon;
revoke execute on function public.quote_venue_booking(uuid, numeric) from public, anon;
revoke execute on function public.confirm_venue_booking(uuid) from public, anon;
revoke execute on function public.decline_venue_booking(uuid, text) from public, anon;
revoke execute on function public.cancel_venue_booking(uuid) from public, anon;

grant execute on function public.request_venue_booking(uuid, timestamptz, timestamptz, int, text, text, text, text) to authenticated;
grant execute on function public.quote_venue_booking(uuid, numeric) to authenticated;
grant execute on function public.confirm_venue_booking(uuid) to authenticated;
grant execute on function public.decline_venue_booking(uuid, text) to authenticated;
grant execute on function public.cancel_venue_booking(uuid) to authenticated;

-- Plasă de siguranță descoperită la prima probă în browser: o locație fără
-- personal înregistrat (exact cazul unei locații proaspăt onboardate) primea
-- cereri pe care nu le vedea NIMENI — bucla de notificare nu avea pe cine
-- anunța, iar cererea murea în tăcere. Dacă nu există staff, anunțăm
-- administratorul platformei, ca cererea să ajungă la un om.
create or replace function public.notify_venue_staff_or_admin(
  p_venue_id uuid, p_title text, p_body text, p_url text, p_tag text
)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_sent int := 0;
  v_row record;
begin
  for v_row in select user_id from public.restaurant_staff where restaurant_id = p_venue_id loop
    insert into public.notification_outbox (user_id, title, body, url, tag)
    values (v_row.user_id, p_title, p_body, p_url, p_tag);
    v_sent := v_sent + 1;
  end loop;

  if v_sent = 0 then
    for v_row in select id as user_id from public.profiles where role = 'platform_admin' loop
      insert into public.notification_outbox (user_id, title, body, url, tag)
      values (v_row.user_id, p_title || ' (locație fără personal)', p_body, '/platform/crm', p_tag);
    end loop;
  end if;
end;
$$;

create or replace function public.request_venue_booking(
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_party_size int,
  p_purpose text,
  p_contact_person text,
  p_contact_phone text,
  p_notes text default null
)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  if not exists (select 1 from public.restaurants where id = p_venue_id and is_active) then
    raise exception 'locația nu este disponibilă';
  end if;
  if p_starts_at <= now() then
    raise exception 'rezervarea trebuie să înceapă în viitor';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'intervalul rezervării este invalid';
  end if;
  if btrim(coalesce(p_contact_person, '')) = '' or btrim(coalesce(p_contact_phone, '')) = '' then
    raise exception 'persoana și telefonul de contact sunt obligatorii';
  end if;

  insert into public.venue_bookings (venue_id, customer_id, starts_at, ends_at, party_size,
                                     purpose, contact_person, contact_phone, notes)
  values (p_venue_id, auth.uid(), p_starts_at, p_ends_at, p_party_size, p_purpose,
          btrim(p_contact_person), btrim(p_contact_phone), nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;

  perform public.notify_venue_staff_or_admin(
    p_venue_id, 'Cerere de rezervare',
    format('%s persoane, %s', p_party_size,
           to_char(p_starts_at at time zone 'Europe/Chisinau', 'DD.MM HH24:MI')),
    '/restaurant/rezervari', 'booking:' || v_id);

  return v_id;
end;
$$;

revoke execute on function public.notify_venue_staff_or_admin(uuid, text, text, text, text) from public, anon, authenticated;
