-- Rich demo dataset (3/4): orders spanning every lifecycle state (standard +
-- catering), with coherent order_items + delivery_status_events trails.
-- Depends on 01 (restaurants/menu) and 02 (people/fleet) having run first.
--
-- Status coverage: pending_restaurant(A,Q,R) accepted(B,S) ready_for_pickup(C,V)
-- courier_assigned(D) picked_up(E) en_route(F) delivered(G,H,I,J,K,L,U)
-- cancelled(M,O) rejected(N,P,T).

insert into public.orders
  (id, order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
   subtotal_mdl, delivery_fee_mdl, tip_mdl, total_mdl, courier_id, estimated_ready_at, cancellation_reason, notes,
   created_at, updated_at)
values
  -- A: Sushi Yama, pending_restaurant
  ('e0000000-0000-0000-0000-000000000001', 'standard', 'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', 'pending_restaurant', 'cash', 'unpaid', 830, 40, 0, 870, null, null, null,
   'Fără wasabi, vă rog', now() - interval '3 minutes', now() - interval '3 minutes'),
  -- B: Ciocana Grill House, accepted
  ('e0000000-0000-0000-0000-000000000002', 'standard', 'b0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004',
   'f0000000-0000-0000-0000-000000000002', 'accepted', 'online_gateway', 'pending_capture', 390, 35, 0, 425, null,
   now() + interval '13 minutes', null, null, now() - interval '20 minutes', now() - interval '15 minutes'),
  -- C: Fusion Kitchen, ready_for_pickup (gets a LIVE dispatch offer below)
  ('e0000000-0000-0000-0000-000000000003', 'standard', 'b0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000007',
   'f0000000-0000-0000-0000-000000000003', 'ready_for_pickup', 'online_gateway', 'unpaid', 610, 42, 0, 652, null,
   now() + interval '8 minutes', null, null, now() - interval '30 minutes', now() - interval '10 minutes'),
  -- D: Amber Bistro, courier_assigned
  ('e0000000-0000-0000-0000-000000000004', 'standard', 'b0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002',
   'f0000000-0000-0000-0000-000000000004', 'courier_assigned', 'cash', 'unpaid', 460, 55, 0, 515, 'c1000000-0000-0000-0000-000000000004',
   now() - interval '5 minutes', null, null, now() - interval '50 minutes', now() - interval '8 minutes'),
  -- E: Sakura Sushi, picked_up (existing "Curier Test")
  ('e0000000-0000-0000-0000-000000000005', 'standard', 'b0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'f0000000-0000-0000-0000-000000000005', 'picked_up', 'card_on_delivery', 'unpaid', 800, 45, 0, 845, 'c9a68659-0734-413e-95d0-87cd21f4a0f7',
   now() - interval '30 minutes', null, 'Sunați la interfon', now() - interval '70 minutes', now() - interval '20 minutes'),
  -- F: Le Jardin, en_route (existing client@test.md)
  ('e0000000-0000-0000-0000-000000000006', 'standard', 'a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'c5947686-a7a9-49a1-a6d4-f8a9a6c79c97', 'en_route', 'cash', 'unpaid', 460, 60, 0, 520, 'c1000000-0000-0000-0000-000000000005',
   now() - interval '40 minutes', null, null, now() - interval '90 minutes', now() - interval '15 minutes'),
  -- G: Nobu Chișinău, delivered (6 days ago)
  ('e0000000-0000-0000-0000-000000000007', 'standard', 'b0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000003',
   'f0000000-0000-0000-0000-000000000009', 'delivered', 'online_gateway', 'paid', 1580, 70, 0, 1650, 'c1000000-0000-0000-0000-000000000001',
   now() - interval '6 days' + interval '45 minutes', null, null, now() - interval '6 days', now() - interval '6 days' + interval '85 minutes'),
  -- H: Le Petit Chef, delivered (4 days ago)
  ('e0000000-0000-0000-0000-000000000008', 'standard', 'b0000000-0000-0000-0000-000000000010', 'd0000000-0000-0000-0000-000000000005',
   'f0000000-0000-0000-0000-000000000010', 'delivered', 'cash', 'paid', 380, 50, 0, 430, 'c1000000-0000-0000-0000-000000000002',
   now() - interval '4 days' + interval '46 minutes', null, null, now() - interval '4 days', now() - interval '4 days' + interval '95 minutes'),
  -- I: Bamboo Roll, delivered (3 days ago)
  ('e0000000-0000-0000-0000-000000000009', 'standard', 'b0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000006',
   'f0000000-0000-0000-0000-000000000007', 'delivered', 'card_on_delivery', 'paid', 750, 38, 0, 788, 'c1000000-0000-0000-0000-000000000003',
   now() - interval '3 days' + interval '35 minutes', null, null, now() - interval '3 days', now() - interval '3 days' + interval '70 minutes'),
  -- J: Osteria Roma, delivered (today, pending payout)
  ('e0000000-0000-0000-0000-000000000010', 'standard', 'b0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000008',
   'f0000000-0000-0000-0000-000000000008', 'delivered', 'online_gateway', 'paid', 310, 45, 15, 370, 'c1000000-0000-0000-0000-000000000006',
   now() - interval '3 hours' + interval '36 minutes', null, null, now() - interval '3 hours', now() - interval '3 hours' + interval '80 minutes'),
  -- K: Sushi Yama, delivered but disputed (refund_pending)
  ('e0000000-0000-0000-0000-000000000011', 'standard', 'b0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000006', 'delivered', 'online_gateway', 'refund_pending', 960, 40, 0, 1000, 'c1000000-0000-0000-0000-000000000009',
   now() - interval '5 days' + interval '36 minutes', null, null, now() - interval '5 days', now() - interval '5 days' + interval '2 days'),
  -- L: Osaka House, delivered (existing client@test.md)
  ('e0000000-0000-0000-0000-000000000012', 'standard', 'a0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
   'c5947686-a7a9-49a1-a6d4-f8a9a6c79c97', 'delivered', 'online_gateway', 'paid', 630, 40, 20, 690, 'c1000000-0000-0000-0000-000000000008',
   now() - interval '2 days' + interval '34 minutes', null, null, now() - interval '2 days', now() - interval '2 days' + interval '70 minutes'),
  -- M: Sakura Sushi, cancelled by customer
  ('e0000000-0000-0000-0000-000000000013', 'standard', 'b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'f0000000-0000-0000-0000-000000000001', 'cancelled', 'online_gateway', 'unpaid', 390, 45, 0, 435, null, null,
   'Client s-a răzgândit', null, now() - interval '2 hours', now() - interval '1 hour 59 minutes'),
  -- N: Le Jardin, rejected by restaurant
  ('e0000000-0000-0000-0000-000000000014', 'standard', 'b0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'f0000000-0000-0000-0000-000000000002', 'rejected', 'online_gateway', 'failed', 340, 60, 0, 400, null, null,
   'Ingrediente indisponibile momentan', null, now() - interval '5 hours', now() - interval '4 hours 50 minutes'),
  -- O: Amber Bistro, cancelled by admin mid-flight (courier freed, refunded)
  ('e0000000-0000-0000-0000-000000000015', 'standard', 'b0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002',
   'f0000000-0000-0000-0000-000000000003', 'cancelled', 'online_gateway', 'refunded', 420, 55, 0, 475, 'c1000000-0000-0000-0000-000000000007',
   now() - interval '2 hours 15 minutes', 'Restaurant a raportat o urgență, comandă anulată de administrator', null,
   now() - interval '3 hours', now() - interval '2 hours 5 minutes'),
  -- P: Ciocana Grill House, rejected
  ('e0000000-0000-0000-0000-000000000016', 'standard', 'b0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004',
   'f0000000-0000-0000-0000-000000000004', 'rejected', 'cash', 'unpaid', 260, 35, 0, 295, null, null,
   'Bucătăria închisă temporar', null, now() - interval '6 hours', now() - interval '5 hours 50 minutes'),
  -- Q: Sakura Sushi catering, quote requested
  ('e0000000-0000-0000-0000-000000000017', 'catering', 'b0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   null, 'pending_restaurant', 'cash', 'unpaid', 4800, 45, 0, 4845, null, null, null, null,
   now() - interval '2 days', now() - interval '2 days'),
  -- R: Le Jardin catering, quoted
  ('e0000000-0000-0000-0000-000000000018', 'catering', 'b0000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222',
   null, 'pending_restaurant', 'cash', 'unpaid', 14400, 60, 0, 14460, null, null, null, null,
   now() - interval '3 days', now() - interval '3 days'),
  -- S: Amber Bistro catering, confirmed (accepted)
  ('e0000000-0000-0000-0000-000000000019', 'catering', 'b0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000002',
   null, 'accepted', 'cash', 'unpaid', 10400, 55, 0, 10800, null, null, null, null,
   now() - interval '5 days', now() - interval '4 days 18 hours'),
  -- T: Nobu Chișinău catering, declined (rejected)
  ('e0000000-0000-0000-0000-000000000020', 'catering', 'b0000000-0000-0000-0000-000000000010', 'd0000000-0000-0000-0000-000000000003',
   null, 'rejected', 'cash', 'unpaid', 5800, 70, 0, 5870, null, null, 'Nu putem onora în această dată', null,
   now() - interval '4 days', now() - interval '3 days 22 hours'),
  -- U: Fusion Kitchen catering, full pipeline -> delivered
  ('e0000000-0000-0000-0000-000000000021', 'catering', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000007',
   null, 'delivered', 'card_on_delivery', 'paid', 8700, 42, 0, 9200, 'c1000000-0000-0000-0000-000000000001', null, null, null,
   now() - interval '2 days', now() - interval '1 day 1 hour'),
  -- V: Bamboo Roll, ready_for_pickup, no assignment yet (offer cascade below)
  ('e0000000-0000-0000-0000-000000000022', 'standard', 'b0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000006',
   'f0000000-0000-0000-0000-000000000009', 'ready_for_pickup', 'cash', 'unpaid', 640, 38, 0, 678, null,
   now() + interval '10 minutes', null, null, now() - interval '25 minutes', now() - interval '12 minutes');

-- ============================================================================
-- Catering details (Q, R, S, T, U)
-- ============================================================================
insert into public.catering_details
  (order_id, event_date, event_time, guest_count, event_address_text, contact_person, contact_phone,
   quote_status, quoted_total_mdl, restaurant_notes, created_at)
values
  ('e0000000-0000-0000-0000-000000000017', current_date + 14, '18:00', 40,
   'Sala de evenimente "Panorama", Str. Alba Iulia 10', 'Maria Robu', '+37369200005', 'requested', null, null, now() - interval '2 days'),
  ('e0000000-0000-0000-0000-000000000018', current_date + 20, '19:30', 25,
   'Restaurant privat, Bd. Dacia 44', 'Cristina Bălan', '+37369200007', 'quoted', 15000, null, now() - interval '3 days'),
  ('e0000000-0000-0000-0000-000000000019', current_date + 10, '17:00', 15,
   'Vilă privată, Str. Trandafirilor 8', 'Victor Donos', '+37369200008', 'confirmed', 10800, null, now() - interval '5 days'),
  ('e0000000-0000-0000-0000-000000000020', current_date + 5, '20:00', 20,
   'Sală de conferințe, Bd. Ștefan cel Mare 200', 'Sergiu Pleșca', '+37369200010', 'declined', null,
   'Nu putem onora în această dată', now() - interval '4 days'),
  ('e0000000-0000-0000-0000-000000000021', current_date - 1, '12:00', 30,
   'Birou corporate, Str. Alecu Russo 28', 'Client Test', '+37360000000', 'confirmed', 9200, null, now() - interval '2 days');

-- ============================================================================
-- Order items — one statement, joined against menu_items by (restaurant, name)
-- ============================================================================
insert into public.order_items (order_id, menu_item_id, item_name_snapshot, unit_price_mdl, quantity, line_total_mdl)
select v.order_id, mi.id, mi.name, mi.price_mdl, v.qty, mi.price_mdl * v.qty
from (values
  ('e0000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000001'::uuid, 'Set Yama 20 piese', 1),
  ('e0000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000001'::uuid, 'California Roll', 2),
  ('e0000000-0000-0000-0000-000000000002'::uuid, 'd0000000-0000-0000-0000-000000000004'::uuid, 'Ceafă de porc la grătar', 1),
  ('e0000000-0000-0000-0000-000000000002'::uuid, 'd0000000-0000-0000-0000-000000000004'::uuid, 'Mici tradiționali (6 buc)', 1),
  ('e0000000-0000-0000-0000-000000000002'::uuid, 'd0000000-0000-0000-0000-000000000004'::uuid, 'Cartofi copți cu rozmarin', 1),
  ('e0000000-0000-0000-0000-000000000003'::uuid, 'd0000000-0000-0000-0000-000000000007'::uuid, 'Pad Thai cu creveți', 1),
  ('e0000000-0000-0000-0000-000000000003'::uuid, 'd0000000-0000-0000-0000-000000000007'::uuid, 'Poke Bowl Somon', 1),
  ('e0000000-0000-0000-0000-000000000003'::uuid, 'd0000000-0000-0000-0000-000000000007'::uuid, 'Spring Rolls cu legume', 2),
  ('e0000000-0000-0000-0000-000000000004'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid, 'Magret de rață', 1),
  ('e0000000-0000-0000-0000-000000000004'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid, 'Crème brûlée', 1),
  ('e0000000-0000-0000-0000-000000000005'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Set Sakura 32 piese', 1),
  ('e0000000-0000-0000-0000-000000000005'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'California Roll', 1),
  ('e0000000-0000-0000-0000-000000000006'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Magret de rață', 1),
  ('e0000000-0000-0000-0000-000000000006'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Crème brûlée', 1),
  ('e0000000-0000-0000-0000-000000000007'::uuid, 'd0000000-0000-0000-0000-000000000003'::uuid, 'Omakase Nobu 12 feluri', 1),
  ('e0000000-0000-0000-0000-000000000007'::uuid, 'd0000000-0000-0000-0000-000000000003'::uuid, 'Nigiri Toro (2 buc)', 1),
  ('e0000000-0000-0000-0000-000000000008'::uuid, 'd0000000-0000-0000-0000-000000000005'::uuid, 'Coq au vin', 1),
  ('e0000000-0000-0000-0000-000000000008'::uuid, 'd0000000-0000-0000-0000-000000000005'::uuid, 'Tarte au citron', 1),
  ('e0000000-0000-0000-0000-000000000009'::uuid, 'd0000000-0000-0000-0000-000000000006'::uuid, 'Set Bamboo 16 piese', 1),
  ('e0000000-0000-0000-0000-000000000009'::uuid, 'd0000000-0000-0000-0000-000000000006'::uuid, 'California Roll', 2),
  ('e0000000-0000-0000-0000-000000000010'::uuid, 'd0000000-0000-0000-0000-000000000008'::uuid, 'Lasagna della Casa', 1),
  ('e0000000-0000-0000-0000-000000000010'::uuid, 'd0000000-0000-0000-0000-000000000008'::uuid, 'Tiramisù', 1),
  ('e0000000-0000-0000-0000-000000000011'::uuid, 'd0000000-0000-0000-0000-000000000001'::uuid, 'Set Yama 20 piese', 1),
  ('e0000000-0000-0000-0000-000000000011'::uuid, 'd0000000-0000-0000-0000-000000000001'::uuid, 'Yama Dragon Roll', 2),
  ('e0000000-0000-0000-0000-000000000012'::uuid, '33333333-3333-3333-3333-333333333333'::uuid, 'Dragon Roll', 2),
  ('e0000000-0000-0000-0000-000000000012'::uuid, '33333333-3333-3333-3333-333333333333'::uuid, 'Spicy Tuna Roll', 1),
  ('e0000000-0000-0000-0000-000000000013'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'California Roll', 1),
  ('e0000000-0000-0000-0000-000000000013'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Philadelphia Roll', 1),
  ('e0000000-0000-0000-0000-000000000014'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Magret de rață', 1),
  ('e0000000-0000-0000-0000-000000000015'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid, 'File de vită Wellington', 1),
  ('e0000000-0000-0000-0000-000000000016'::uuid, 'd0000000-0000-0000-0000-000000000004'::uuid, 'Cotlet de vită la grătar', 1),
  ('e0000000-0000-0000-0000-000000000017'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Platou Eveniment 100 piese', 2),
  ('e0000000-0000-0000-0000-000000000018'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Meniu Eveniment Le Jardin (10 persoane)', 3),
  ('e0000000-0000-0000-0000-000000000019'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid, 'Meniu Eveniment Amber (10 persoane)', 2),
  ('e0000000-0000-0000-0000-000000000020'::uuid, 'd0000000-0000-0000-0000-000000000003'::uuid, 'Platou Omakase Corporate 100 piese', 1),
  ('e0000000-0000-0000-0000-000000000021'::uuid, 'd0000000-0000-0000-0000-000000000007'::uuid, 'Platou Fusion Eveniment', 3),
  ('e0000000-0000-0000-0000-000000000022'::uuid, 'd0000000-0000-0000-0000-000000000006'::uuid, 'Set Bamboo 16 piese', 1),
  ('e0000000-0000-0000-0000-000000000022'::uuid, 'd0000000-0000-0000-0000-000000000006'::uuid, 'Bamboo Dragon Roll', 1)
) as v(order_id, restaurant_id, name, qty)
join public.menu_items mi on mi.restaurant_id = v.restaurant_id and mi.name = v.name;

-- ============================================================================
-- Delivery status events — the full audit trail per order
-- ============================================================================
insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note, created_at) values
  -- A
  ('e0000000-0000-0000-0000-000000000001', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000001', null, now() - interval '3 minutes'),
  -- B
  ('e0000000-0000-0000-0000-000000000002', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000002', null, now() - interval '20 minutes'),
  ('e0000000-0000-0000-0000-000000000002', 'accepted', 'restaurant_partner', null, null, now() - interval '15 minutes'),
  -- C
  ('e0000000-0000-0000-0000-000000000003', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000003', null, now() - interval '30 minutes'),
  ('e0000000-0000-0000-0000-000000000003', 'accepted', 'restaurant_partner', null, null, now() - interval '25 minutes'),
  ('e0000000-0000-0000-0000-000000000003', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '10 minutes'),
  -- D
  ('e0000000-0000-0000-0000-000000000004', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000004', null, now() - interval '50 minutes'),
  ('e0000000-0000-0000-0000-000000000004', 'accepted', 'restaurant_partner', null, null, now() - interval '45 minutes'),
  ('e0000000-0000-0000-0000-000000000004', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '9 minutes'),
  ('e0000000-0000-0000-0000-000000000004', 'courier_assigned', 'courier', 'c0000000-0000-0000-0000-000000000004', null, now() - interval '8 minutes'),
  -- E
  ('e0000000-0000-0000-0000-000000000005', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000005', null, now() - interval '70 minutes'),
  ('e0000000-0000-0000-0000-000000000005', 'accepted', 'restaurant_partner', 'a0000000-0000-0000-0000-000000000003', null, now() - interval '65 minutes'),
  ('e0000000-0000-0000-0000-000000000005', 'ready_for_pickup', 'restaurant_partner', 'a0000000-0000-0000-0000-000000000003', null, now() - interval '35 minutes'),
  ('e0000000-0000-0000-0000-000000000005', 'courier_assigned', 'courier', 'a0000000-0000-0000-0000-000000000002', null, now() - interval '30 minutes'),
  ('e0000000-0000-0000-0000-000000000005', 'picked_up', 'courier', 'a0000000-0000-0000-0000-000000000002', null, now() - interval '20 minutes'),
  -- F
  ('e0000000-0000-0000-0000-000000000006', 'pending_restaurant', 'customer', 'a0000000-0000-0000-0000-000000000001', null, now() - interval '90 minutes'),
  ('e0000000-0000-0000-0000-000000000006', 'accepted', 'restaurant_partner', null, null, now() - interval '85 minutes'),
  ('e0000000-0000-0000-0000-000000000006', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '50 minutes'),
  ('e0000000-0000-0000-0000-000000000006', 'courier_assigned', 'courier', 'c0000000-0000-0000-0000-000000000005', null, now() - interval '45 minutes'),
  ('e0000000-0000-0000-0000-000000000006', 'picked_up', 'courier', 'c0000000-0000-0000-0000-000000000005', null, now() - interval '25 minutes'),
  ('e0000000-0000-0000-0000-000000000006', 'en_route', 'courier', 'c0000000-0000-0000-0000-000000000005', null, now() - interval '15 minutes'),
  -- G
  ('e0000000-0000-0000-0000-000000000007', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000009', null, now() - interval '6 days'),
  ('e0000000-0000-0000-0000-000000000007', 'accepted', 'restaurant_partner', null, null, now() - interval '6 days' + interval '5 minutes'),
  ('e0000000-0000-0000-0000-000000000007', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '6 days' + interval '45 minutes'),
  ('e0000000-0000-0000-0000-000000000007', 'courier_assigned', 'courier', 'c0000000-0000-0000-0000-000000000001', null, now() - interval '6 days' + interval '48 minutes'),
  ('e0000000-0000-0000-0000-000000000007', 'picked_up', 'courier', 'c0000000-0000-0000-0000-000000000001', null, now() - interval '6 days' + interval '55 minutes'),
  ('e0000000-0000-0000-0000-000000000007', 'en_route', 'courier', 'c0000000-0000-0000-0000-000000000001', null, now() - interval '6 days' + interval '58 minutes'),
  ('e0000000-0000-0000-0000-000000000007', 'delivered', 'courier', 'c0000000-0000-0000-0000-000000000001', null, now() - interval '6 days' + interval '85 minutes'),
  -- H
  ('e0000000-0000-0000-0000-000000000008', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000010', null, now() - interval '4 days'),
  ('e0000000-0000-0000-0000-000000000008', 'accepted', 'restaurant_partner', null, null, now() - interval '4 days' + interval '8 minutes'),
  ('e0000000-0000-0000-0000-000000000008', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '4 days' + interval '46 minutes'),
  ('e0000000-0000-0000-0000-000000000008', 'courier_assigned', 'courier', 'c0000000-0000-0000-0000-000000000002', null, now() - interval '4 days' + interval '50 minutes'),
  ('e0000000-0000-0000-0000-000000000008', 'picked_up', 'courier', 'c0000000-0000-0000-0000-000000000002', null, now() - interval '4 days' + interval '58 minutes'),
  ('e0000000-0000-0000-0000-000000000008', 'en_route', 'courier', 'c0000000-0000-0000-0000-000000000002', null, now() - interval '4 days' + interval '62 minutes'),
  ('e0000000-0000-0000-0000-000000000008', 'delivered', 'courier', 'c0000000-0000-0000-0000-000000000002', null, now() - interval '4 days' + interval '95 minutes'),
  -- I
  ('e0000000-0000-0000-0000-000000000009', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000007', null, now() - interval '3 days'),
  ('e0000000-0000-0000-0000-000000000009', 'accepted', 'restaurant_partner', null, null, now() - interval '3 days' + interval '5 minutes'),
  ('e0000000-0000-0000-0000-000000000009', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '3 days' + interval '35 minutes'),
  ('e0000000-0000-0000-0000-000000000009', 'courier_assigned', 'courier', 'c0000000-0000-0000-0000-000000000003', null, now() - interval '3 days' + interval '38 minutes'),
  ('e0000000-0000-0000-0000-000000000009', 'picked_up', 'courier', 'c0000000-0000-0000-0000-000000000003', null, now() - interval '3 days' + interval '45 minutes'),
  ('e0000000-0000-0000-0000-000000000009', 'en_route', 'courier', 'c0000000-0000-0000-0000-000000000003', null, now() - interval '3 days' + interval '48 minutes'),
  ('e0000000-0000-0000-0000-000000000009', 'delivered', 'courier', 'c0000000-0000-0000-0000-000000000003', null, now() - interval '3 days' + interval '70 minutes'),
  -- J
  ('e0000000-0000-0000-0000-000000000010', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000008', null, now() - interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000010', 'accepted', 'restaurant_partner', null, null, now() - interval '3 hours' + interval '6 minutes'),
  ('e0000000-0000-0000-0000-000000000010', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '3 hours' + interval '36 minutes'),
  ('e0000000-0000-0000-0000-000000000010', 'courier_assigned', 'courier', 'c0000000-0000-0000-0000-000000000006', null, now() - interval '3 hours' + interval '40 minutes'),
  ('e0000000-0000-0000-0000-000000000010', 'picked_up', 'courier', 'c0000000-0000-0000-0000-000000000006', null, now() - interval '3 hours' + interval '48 minutes'),
  ('e0000000-0000-0000-0000-000000000010', 'en_route', 'courier', 'c0000000-0000-0000-0000-000000000006', null, now() - interval '3 hours' + interval '52 minutes'),
  ('e0000000-0000-0000-0000-000000000010', 'delivered', 'courier', 'c0000000-0000-0000-0000-000000000006', null, now() - interval '3 hours' + interval '80 minutes'),
  -- K (+ post-delivery dispute note)
  ('e0000000-0000-0000-0000-000000000011', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000006', null, now() - interval '5 days'),
  ('e0000000-0000-0000-0000-000000000011', 'accepted', 'restaurant_partner', null, null, now() - interval '5 days' + interval '4 minutes'),
  ('e0000000-0000-0000-0000-000000000011', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '5 days' + interval '36 minutes'),
  ('e0000000-0000-0000-0000-000000000011', 'courier_assigned', 'courier', 'c0000000-0000-0000-0000-000000000009', null, now() - interval '5 days' + interval '39 minutes'),
  ('e0000000-0000-0000-0000-000000000011', 'picked_up', 'courier', 'c0000000-0000-0000-0000-000000000009', null, now() - interval '5 days' + interval '46 minutes'),
  ('e0000000-0000-0000-0000-000000000011', 'en_route', 'courier', 'c0000000-0000-0000-0000-000000000009', null, now() - interval '5 days' + interval '49 minutes'),
  ('e0000000-0000-0000-0000-000000000011', 'delivered', 'courier', 'c0000000-0000-0000-0000-000000000009', null, now() - interval '5 days' + interval '75 minutes'),
  ('e0000000-0000-0000-0000-000000000011', 'delivered', 'platform_admin', 'a0000000-0000-0000-0000-000000000004', 'payment: paid -> refund_pending — client dispute', now() - interval '5 days' + interval '2 days'),
  -- L
  ('e0000000-0000-0000-0000-000000000012', 'pending_restaurant', 'customer', 'a0000000-0000-0000-0000-000000000001', null, now() - interval '2 days'),
  ('e0000000-0000-0000-0000-000000000012', 'accepted', 'restaurant_partner', null, null, now() - interval '2 days' + interval '4 minutes'),
  ('e0000000-0000-0000-0000-000000000012', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '2 days' + interval '34 minutes'),
  ('e0000000-0000-0000-0000-000000000012', 'courier_assigned', 'courier', 'c0000000-0000-0000-0000-000000000008', null, now() - interval '2 days' + interval '37 minutes'),
  ('e0000000-0000-0000-0000-000000000012', 'picked_up', 'courier', 'c0000000-0000-0000-0000-000000000008', null, now() - interval '2 days' + interval '44 minutes'),
  ('e0000000-0000-0000-0000-000000000012', 'en_route', 'courier', 'c0000000-0000-0000-0000-000000000008', null, now() - interval '2 days' + interval '47 minutes'),
  ('e0000000-0000-0000-0000-000000000012', 'delivered', 'courier', 'c0000000-0000-0000-0000-000000000008', null, now() - interval '2 days' + interval '70 minutes'),
  -- M
  ('e0000000-0000-0000-0000-000000000013', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000001', null, now() - interval '2 hours'),
  ('e0000000-0000-0000-0000-000000000013', 'cancelled', 'customer', 'b0000000-0000-0000-0000-000000000001', 'Client s-a răzgândit', now() - interval '1 hour 59 minutes'),
  -- N
  ('e0000000-0000-0000-0000-000000000014', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000002', null, now() - interval '5 hours'),
  ('e0000000-0000-0000-0000-000000000014', 'rejected', 'restaurant_partner', null, 'Ingrediente indisponibile momentan', now() - interval '4 hours 50 minutes'),
  -- O (+ post-cancel refund note)
  ('e0000000-0000-0000-0000-000000000015', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000003', null, now() - interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000015', 'accepted', 'restaurant_partner', null, null, now() - interval '2 hours 55 minutes'),
  ('e0000000-0000-0000-0000-000000000015', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '2 hours 20 minutes'),
  ('e0000000-0000-0000-0000-000000000015', 'courier_assigned', 'courier', 'c0000000-0000-0000-0000-000000000007', null, now() - interval '2 hours 15 minutes'),
  ('e0000000-0000-0000-0000-000000000015', 'cancelled', 'platform_admin', 'a0000000-0000-0000-0000-000000000004', 'Restaurant a raportat o urgență, comandă anulată de administrator', now() - interval '2 hours 10 minutes'),
  ('e0000000-0000-0000-0000-000000000015', 'cancelled', 'platform_admin', 'a0000000-0000-0000-0000-000000000004', 'payment: paid -> refunded — anulare restaurant', now() - interval '2 hours 5 minutes'),
  -- P
  ('e0000000-0000-0000-0000-000000000016', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000004', null, now() - interval '6 hours'),
  ('e0000000-0000-0000-0000-000000000016', 'rejected', 'restaurant_partner', null, 'Bucătăria închisă temporar', now() - interval '5 hours 50 minutes'),
  -- Q
  ('e0000000-0000-0000-0000-000000000017', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000005', null, now() - interval '2 days'),
  -- R
  ('e0000000-0000-0000-0000-000000000018', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000007', null, now() - interval '3 days'),
  -- S
  ('e0000000-0000-0000-0000-000000000019', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000008', null, now() - interval '5 days'),
  ('e0000000-0000-0000-0000-000000000019', 'accepted', 'customer', 'b0000000-0000-0000-0000-000000000008', null, now() - interval '4 days 18 hours'),
  -- T
  ('e0000000-0000-0000-0000-000000000020', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000010', null, now() - interval '4 days'),
  ('e0000000-0000-0000-0000-000000000020', 'rejected', 'restaurant_partner', null, 'Nu putem onora în această dată', now() - interval '3 days 22 hours'),
  -- U
  ('e0000000-0000-0000-0000-000000000021', 'pending_restaurant', 'customer', 'a0000000-0000-0000-0000-000000000001', null, now() - interval '2 days'),
  ('e0000000-0000-0000-0000-000000000021', 'accepted', 'customer', 'a0000000-0000-0000-0000-000000000001', null, now() - interval '1 day 18 hours'),
  ('e0000000-0000-0000-0000-000000000021', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '1 day 2 hours'),
  ('e0000000-0000-0000-0000-000000000021', 'courier_assigned', 'courier', 'c0000000-0000-0000-0000-000000000001', null, now() - interval '1 day 1 hour 50 minutes'),
  ('e0000000-0000-0000-0000-000000000021', 'picked_up', 'courier', 'c0000000-0000-0000-0000-000000000001', null, now() - interval '1 day 1 hour 40 minutes'),
  ('e0000000-0000-0000-0000-000000000021', 'en_route', 'courier', 'c0000000-0000-0000-0000-000000000001', null, now() - interval '1 day 1 hour 35 minutes'),
  ('e0000000-0000-0000-0000-000000000021', 'delivered', 'courier', 'c0000000-0000-0000-0000-000000000001', null, now() - interval '1 day 1 hour'),
  -- V
  ('e0000000-0000-0000-0000-000000000022', 'pending_restaurant', 'customer', 'b0000000-0000-0000-0000-000000000009', null, now() - interval '25 minutes'),
  ('e0000000-0000-0000-0000-000000000022', 'accepted', 'restaurant_partner', null, null, now() - interval '20 minutes'),
  ('e0000000-0000-0000-0000-000000000022', 'ready_for_pickup', 'restaurant_partner', null, null, now() - interval '12 minutes');
