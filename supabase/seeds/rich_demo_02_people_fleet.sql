-- Rich demo dataset (2/4): demo customer + courier accounts, courier fleet,
-- delivery addresses, and favorites. Mirrors local_test_users.sql conventions
-- exactly (auth.users token columns '' not null, password parola123 for all,
-- customer profiles auto-created by handle_new_customer_signup).

do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- 10 demo customers (auto-provisioned profiles via the signup trigger)
      ('b0000000-0000-0000-0000-000000000001'::uuid, 'ana.popescu@test.md',     'customer', 'Ana Popescu'),
      ('b0000000-0000-0000-0000-000000000002'::uuid, 'mihai.rusu@test.md',      'customer', 'Mihai Rusu'),
      ('b0000000-0000-0000-0000-000000000003'::uuid, 'elena.vasilescu@test.md', 'customer', 'Elena Vasilescu'),
      ('b0000000-0000-0000-0000-000000000004'::uuid, 'ion.cretu@test.md',       'customer', 'Ion Crețu'),
      ('b0000000-0000-0000-0000-000000000005'::uuid, 'maria.robu@test.md',      'customer', 'Maria Robu'),
      ('b0000000-0000-0000-0000-000000000006'::uuid, 'andrei.moraru@test.md',   'customer', 'Andrei Moraru'),
      ('b0000000-0000-0000-0000-000000000007'::uuid, 'cristina.balan@test.md',  'customer', 'Cristina Bălan'),
      ('b0000000-0000-0000-0000-000000000008'::uuid, 'victor.donos@test.md',    'customer', 'Victor Donos'),
      ('b0000000-0000-0000-0000-000000000009'::uuid, 'natalia.gorea@test.md',   'customer', 'Natalia Gorea'),
      ('b0000000-0000-0000-0000-000000000010'::uuid, 'sergiu.plesca@test.md',   'customer', 'Sergiu Pleșca'),
      -- 9 demo couriers (profiles created explicitly below, role <> customer)
      ('c0000000-0000-0000-0000-000000000001'::uuid, 'vlad.ciobanu.courier@test.md',      'courier', 'Vlad Ciobanu'),
      ('c0000000-0000-0000-0000-000000000002'::uuid, 'nicolae.bejan.courier@test.md',     'courier', 'Nicolae Bejan'),
      ('c0000000-0000-0000-0000-000000000003'::uuid, 'dumitru.rusnac.courier@test.md',    'courier', 'Dumitru Rusnac'),
      ('c0000000-0000-0000-0000-000000000004'::uuid, 'ion.bulgaru.courier@test.md',       'courier', 'Ion Bulgaru'),
      ('c0000000-0000-0000-0000-000000000005', 'andrei.cazacu.courier@test.md',     'courier', 'Andrei Cazacu'),
      ('c0000000-0000-0000-0000-000000000006', 'veaceslav.munteanu.courier@test.md','courier', 'Veaceslav Munteanu'),
      ('c0000000-0000-0000-0000-000000000007', 'grigore.tofan.courier@test.md',     'courier', 'Grigore Tofan'),
      ('c0000000-0000-0000-0000-000000000008', 'radu.sandu.courier@test.md',        'courier', 'Radu Sandu'),
      ('c0000000-0000-0000-0000-000000000009', 'denis.covali.courier@test.md',      'courier', 'Denis Covali')
    ) as t(id, email, role, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token, phone_change, phone_change_token
    ) values (
      '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email,
      extensions.crypt('parola123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('role', r.role, 'full_name', r.full_name),
      now(), now(), '', '', '', '', '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (r.id::text, r.id, jsonb_build_object('sub', r.id::text, 'email', r.email), 'email', now(), now(), now())
    on conflict (provider_id, provider) do nothing;

    if r.role <> 'customer' then
      insert into public.profiles (id, full_name, phone, role)
      values (r.id, r.full_name, null, r.role)
      on conflict (id) do update set role = excluded.role;
    end if;
  end loop;
end $$;

-- ============================================================================
-- Courier fleet — 9 new couriers (+ the existing "Curier Test") across every
-- vehicle type and status, positioned near their home sector.
-- ============================================================================
insert into public.couriers (id, user_id, full_name, phone, vehicle_type, status, is_active) values
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Vlad Ciobanu',       '+37369100001', 'bike',    'online',      true),
  ('c1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Nicolae Bejan',      '+37369100002', 'e_bike',  'online',      true),
  ('c1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'Dumitru Rusnac',     '+37369100003', 'scooter', 'online',      true),
  ('c1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'Ion Bulgaru',        '+37369100004', 'car',     'on_delivery', true),
  ('c1000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'Andrei Cazacu',      '+37369100005', 'car',     'on_delivery', true),
  ('c1000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000006', 'Veaceslav Munteanu', '+37369100006', 'bike',    'online',      true),
  ('c1000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000007', 'Grigore Tofan',      '+37369100007', 'e_bike',  'offline',     true),
  ('c1000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000008', 'Radu Sandu',         '+37369100008', 'scooter', 'online',      true),
  ('c1000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000009', 'Denis Covali',       '+37369100009', 'on_foot', 'online',      true);

insert into public.courier_locations (courier_id, lat, lng, accuracy_m) values
  ('c1000000-0000-0000-0000-000000000001', 47.020500, 28.835500, 8.0),  -- Vlad — Centru
  ('c1000000-0000-0000-0000-000000000002', 47.001800, 28.850500, 6.0),  -- Nicolae — Botanica
  ('c1000000-0000-0000-0000-000000000003', 47.060200, 28.855800, 10.0), -- Dumitru — Râșcani
  ('c1000000-0000-0000-0000-000000000004', 47.032500, 28.900500, 7.0),  -- Ion — Ciocana
  ('c1000000-0000-0000-0000-000000000005', 47.035500, 28.805500, 9.0),  -- Andrei — Buiucani
  ('c1000000-0000-0000-0000-000000000006', 46.999500, 28.798500, 6.0),  -- Veaceslav — Telecentru
  ('c1000000-0000-0000-0000-000000000007', 47.015500, 28.828500, 12.0), -- Grigore — Centru (offline, stale-ish)
  ('c1000000-0000-0000-0000-000000000008', 47.005500, 28.848500, 5.0),  -- Radu — Botanica
  ('c1000000-0000-0000-0000-000000000009', 47.023500, 28.832500, 4.0);  -- Denis — Centru

-- ============================================================================
-- Delivery addresses — one per new demo customer, sector-matched.
-- ============================================================================
insert into public.addresses (id, customer_id, label, street_address, sector, building, apartment, lat, lng, is_default) values
  -- existing client@test.md (a0…001) home address — orders F & L reference it by this
  -- pinned id, so it must exist on a fresh reset (was previously a live-DB-only row).
  ('c5947686-a7a9-49a1-a6d4-f8a9a6c79c97', 'a0000000-0000-0000-0000-000000000001', 'Acasă', 'Str. Bănulescu-Bodoni 25', 'Centru', '1', '3', 47.023500, 28.831500, true),
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Acasă', 'Str. Ismail 40', 'Centru', '12', '5', 47.021000, 28.834000, true),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Acasă', 'Str. Independenței 55', 'Botanica', '3', '22', 47.000500, 28.851500, true),
  ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'Acasă', 'Str. Kiev 27', 'Râșcani', '6', '14', 47.067000, 28.859000, true),
  ('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'Acasă', 'Str. Mihail Sadoveanu 18', 'Ciocana', '2', '8', 47.031500, 28.902500, true),
  ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 'Acasă', 'Str. Calea Ieșilor 21', 'Buiucani', '5', '31', 47.040000, 28.803000, true),
  ('f0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000006', 'Acasă', 'Str. N. Zelinski 12', 'Telecentru', '1', '9', 46.997500, 28.796500, true),
  ('f0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000007', 'Acasă', 'Str. Columna 30', 'Centru', '9', '17', 47.017500, 28.827500, true),
  ('f0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000008', 'Acasă', 'Str. Grenoble 88', 'Botanica', '4', '40', 47.003500, 28.847500, true),
  ('f0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000009', 'Acasă', 'Str. Alecu Russo 12', 'Râșcani', '7', '52', 47.058000, 28.867000, true),
  ('f0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000010', 'Acasă', 'Str. Vasile Lupu 3', 'Buiucani', '1', '2', 47.038000, 28.801000, true);

-- ============================================================================
-- Favorites — mix of existing + demo customers across all 11 restaurants.
-- ============================================================================
insert into public.favorites (customer_id, restaurant_id)
select u.id, r.id
from auth.users u, public.restaurants r
where (u.email, r.slug) in (
  ('client@test.md',           'sakura-sushi'),
  ('client@test.md',           'nobu-chisinau'),
  ('client@test.md',           'fusion-kitchen'),
  ('ana.popescu@test.md',      'nobu-chisinau'),
  ('ana.popescu@test.md',      'osteria-roma'),
  ('mihai.rusu@test.md',       'ciocana-grill-house'),
  ('elena.vasilescu@test.md',  'fusion-kitchen'),
  ('elena.vasilescu@test.md',  'amber-bistro'),
  ('ion.cretu@test.md',        'amber-bistro'),
  ('maria.robu@test.md',       'sakura-sushi'),
  ('andrei.moraru@test.md',    'sushi-yama'),
  ('cristina.balan@test.md',   'bamboo-roll'),
  ('cristina.balan@test.md',   'le-jardin'),
  ('victor.donos@test.md',     'osteria-roma'),
  ('natalia.gorea@test.md',    'nobu-chisinau'),
  ('natalia.gorea@test.md',    'bamboo-roll'),
  ('sergiu.plesca@test.md',    'le-petit-chef')
);

-- ============================================================================
-- Restaurant prep stats (WS4 dynamic ETA) — generated per restaurant across
-- typical lunch/dinner hours so get_prep_estimates() has real hourly + overall
-- data for every restaurant, regardless of the hour the demo is viewed.
-- ============================================================================
insert into public.restaurant_prep_stats (restaurant_id, hour_of_day, sample_count, avg_prep_minutes, p90_prep_minutes)
select
  r.id,
  h.hour,
  12 + (abs(hashtext(r.id::text || h.hour::text)) % 20) as sample_count,
  greatest(8, r.avg_prep_minutes + (abs(hashtext(r.id::text || h.hour::text || 'a')) % 9) - 4)::numeric(6,1) as avg_prep_minutes,
  greatest(10, round(r.avg_prep_minutes * 1.35) + (abs(hashtext(r.id::text || h.hour::text || 'b')) % 6))::numeric(6,1) as p90_prep_minutes
from public.restaurants r
cross join (values (11), (12), (13), (17), (18), (19), (20), (21)) as h(hour)
on conflict (restaurant_id, hour_of_day) do nothing;
