-- Local dev seed data: restaurants, menus, hours. No auth.users rows here —
-- create test accounts via the local Studio (http://127.0.0.1:54323) sign-up
-- flow, then promote them to courier/restaurant_partner/platform_admin roles
-- with the snippets in docs/dev-setup.md.

insert into public.restaurants
  (id, slug, name, cuisine_type, description, address, sector, phone, accepts_catering, delivery_fee_mdl, min_order_amount_mdl, catering_min_amount_mdl, avg_prep_minutes)
values
  ('11111111-1111-1111-1111-111111111111', 'sakura-sushi', 'Sakura Sushi', 'sushi',
   'Sushi proaspăt, preparat zilnic de bucătari japonezi.', 'Str. Ismail 33', 'Centru', '+37360000001',
   true, 45, 250, 3000, 35),
  ('22222222-2222-2222-2222-222222222222', 'le-jardin', 'Le Jardin', 'fine_dining',
   'Bucătărie franceză contemporană, într-un cadru elegant.', 'Bd. Ștefan cel Mare 120', 'Centru', '+37360000002',
   true, 60, 400, 5000, 45),
  ('33333333-3333-3333-3333-333333333333', 'osaka-house', 'Osaka House', 'sushi',
   'Roluri clasice și seturi omakase pentru livrare.', 'Str. Alba Iulia 75', 'Buiucani', '+37360000003',
   false, 40, 200, null, 30);

insert into public.menu_categories (id, restaurant_id, name, sort_order) values
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Seturi', 1),
  ('a1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Roluri', 2),
  ('a2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Feluri principale', 1),
  ('a2222222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Deserturi', 2),
  ('a3333333-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Roluri clasice', 1);

insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, is_catering_only, catering_min_qty, sort_order) values
  ('11111111-1111-1111-1111-111111111111', 'a1111111-0000-0000-0000-000000000001', 'Set Sakura 32 piese', 'Asortiment de nigiri, sashimi și roluri.', 620, false, null, 1),
  ('11111111-1111-1111-1111-111111111111', 'a1111111-0000-0000-0000-000000000002', 'California Roll', 'Crab, avocado, castravete.', 180, false, null, 1),
  ('11111111-1111-1111-1111-111111111111', 'a1111111-0000-0000-0000-000000000002', 'Philadelphia Roll', 'Somon, cream cheese, avocado.', 210, false, null, 2),
  ('11111111-1111-1111-1111-111111111111', 'a1111111-0000-0000-0000-000000000001', 'Platou Eveniment 100 piese', 'Doar pentru comenzi catering.', 2400, true, 1, 3),
  ('22222222-2222-2222-2222-222222222222', 'a2222222-0000-0000-0000-000000000001', 'Magret de rață', 'Cu piure de țelină și sos de portocale.', 340, false, null, 1),
  ('22222222-2222-2222-2222-222222222222', 'a2222222-0000-0000-0000-000000000002', 'Crème brûlée', 'Vanilie Madagascar.', 120, false, null, 1),
  ('33333333-3333-3333-3333-333333333333', 'a3333333-0000-0000-0000-000000000001', 'Dragon Roll', 'Anghilă, avocado, sos unagi.', 220, false, null, 1),
  ('33333333-3333-3333-3333-333333333333', 'a3333333-0000-0000-0000-000000000001', 'Spicy Tuna Roll', 'Ton picant, castravete.', 190, false, null, 2);

insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at)
select r.id, d, '11:00', '22:00'
from public.restaurants r, generate_series(0, 6) as d;

-- Geo coordinates (WS3): Chișinău points so nearby_restaurants + the ops map work.
-- Demo values — verify against real addresses before public launch.
update public.restaurants set lat = 47.024500, lng = 28.832200 where slug = 'sakura-sushi';
update public.restaurants set lat = 47.011500, lng = 28.860000 where slug = 'le-jardin';
update public.restaurants set lat = 47.050000, lng = 28.810000 where slug = 'osaka-house';

-- Food photography (Unsplash CDN) — keeps local resets visually equivalent
-- to the live project.
update public.restaurants set cover_photo_url = 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800&h=400&fit=crop' where slug = 'sakura-sushi';
update public.restaurants set cover_photo_url = 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=400&fit=crop' where slug = 'le-jardin';
update public.restaurants set cover_photo_url = 'https://images.unsplash.com/photo-1553621042-f6e147245754?w=800&h=400&fit=crop' where slug = 'osaka-house';
update public.menu_items set photo_url = 'https://images.unsplash.com/photo-1583623025817-d180a2221d0a?w=400&h=400&fit=crop' where name = 'Set Sakura 32 piese';
update public.menu_items set photo_url = 'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=400&h=400&fit=crop' where name = 'California Roll';
update public.menu_items set photo_url = 'https://images.unsplash.com/photo-1611143669185-af224c5e3252?w=400&h=400&fit=crop' where name = 'Philadelphia Roll';
update public.menu_items set photo_url = 'https://images.unsplash.com/photo-1625938145312-c18b02a4a913?w=400&h=400&fit=crop' where name = 'Platou Eveniment 100 piese';
update public.menu_items set photo_url = 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop' where name = 'Magret de rață';
update public.menu_items set photo_url = 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop' where name = 'Crème brûlée';
update public.menu_items set photo_url = 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=400&h=400&fit=crop' where name = 'Dragon Roll';
update public.menu_items set photo_url = 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop' where name = 'Spicy Tuna Roll';
