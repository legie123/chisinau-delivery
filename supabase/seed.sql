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
