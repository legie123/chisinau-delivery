-- Rich demo dataset (4/4): dispatch offers, ratings (+ denormalized aggregate
-- sync), payouts, payment intents, fraud flags, notification samples and
-- onboarding applications. Depends on 01-03 having run first.

-- ============================================================================
-- Dispatch offers — live (order C), accepted history (order D), expired +
-- declined cascade history (order V). Respects both partial-unique invariants
-- (one live offer per order/per courier) and the global (order,courier) once-only index.
-- ============================================================================
insert into public.dispatch_offers (order_id, courier_id, wave, score, distance_km, status, offered_at, expires_at, responded_at) values
  ('e0000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000008', 1, 6.20, 1.80, 'offered',
   now() - interval '20 seconds', now() + interval '10 seconds', null),
  ('e0000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000004', 1, 5.10, 1.20, 'accepted',
   now() - interval '9 minutes', now() - interval '8 minutes 30 seconds', now() - interval '8 minutes'),
  ('e0000000-0000-0000-0000-000000000022', 'c1000000-0000-0000-0000-000000000009', 1, 7.40, 2.50, 'expired',
   now() - interval '11 minutes', now() - interval '10 minutes 30 seconds', now() - interval '10 minutes 30 seconds'),
  ('e0000000-0000-0000-0000-000000000022', 'c1000000-0000-0000-0000-000000000006', 2, 8.10, 3.00, 'declined',
   now() - interval '10 minutes 30 seconds', now() - interval '10 minutes', now() - interval '10 minutes 15 seconds');

-- ============================================================================
-- Ratings on delivered orders (restaurant + courier) — created after each
-- order's delivered event, well inside the 30-day window.
-- ============================================================================
insert into public.ratings (order_id, customer_id, target_type, restaurant_id, courier_id, stars, comment, created_at) values
  ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000009', 'restaurant', 'd0000000-0000-0000-0000-000000000003', null, 5, 'Excelent, omakase perfect!', now() - interval '6 days' + interval '4 hours'),
  ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000009', 'courier', null, 'c1000000-0000-0000-0000-000000000001', 5, 'Foarte punctual și amabil.', now() - interval '6 days' + interval '4 hours'),
  ('e0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000010', 'restaurant', 'd0000000-0000-0000-0000-000000000005', null, 4, 'Foarte bun, porții generoase.', now() - interval '4 days' + interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000010', 'courier', null, 'c1000000-0000-0000-0000-000000000002', 5, 'Livrare rapidă.', now() - interval '4 days' + interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000007', 'restaurant', 'd0000000-0000-0000-0000-000000000006', null, 4, 'Rulouri proaspete.', now() - interval '3 days' + interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000007', 'courier', null, 'c1000000-0000-0000-0000-000000000003', 3, 'A întârziat puțin.', now() - interval '3 days' + interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000008', 'restaurant', 'd0000000-0000-0000-0000-000000000008', null, 5, 'Paste excelente!', now() - interval '1 hour'),
  ('e0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000008', 'courier', null, 'c1000000-0000-0000-0000-000000000006', 4, 'Comunicare bună.', now() - interval '1 hour'),
  ('e0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000006', 'restaurant', 'd0000000-0000-0000-0000-000000000001', null, 3, 'Comanda a ajuns mai rece decât mă așteptam.', now() - interval '5 days' + interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000006', 'courier', null, 'c1000000-0000-0000-0000-000000000009', 4, 'Curier ok.', now() - interval '5 days' + interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'restaurant', '33333333-3333-3333-3333-333333333333', null, 5, 'Sushi perfect ca-ntotdeauna.', now() - interval '2 days' + interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'courier', null, 'c1000000-0000-0000-0000-000000000008', 5, 'Super rapid!', now() - interval '2 days' + interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000001', 'restaurant', 'd0000000-0000-0000-0000-000000000007', null, 5, 'Platou excelent pentru eveniment.', now() - interval '23 hours'),
  ('e0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000001', 'courier', null, 'c1000000-0000-0000-0000-000000000001', 5, 'Impecabil.', now() - interval '23 hours');

-- Sync denormalized aggregates (postgres bypasses guard_rating_columns as a
-- privileged role — see migration 20260717002000).
update public.restaurants r set rating_avg = v.avg_stars, rating_count = v.cnt
from (values
  ('d0000000-0000-0000-0000-000000000003'::uuid, 5.00, 1), -- Nobu
  ('d0000000-0000-0000-0000-000000000005'::uuid, 4.00, 1), -- Le Petit Chef
  ('d0000000-0000-0000-0000-000000000006'::uuid, 4.00, 1), -- Bamboo Roll
  ('d0000000-0000-0000-0000-000000000008'::uuid, 5.00, 1), -- Osteria Roma
  ('d0000000-0000-0000-0000-000000000001'::uuid, 3.00, 1), -- Sushi Yama
  ('33333333-3333-3333-3333-333333333333'::uuid, 5.00, 1), -- Osaka House
  ('d0000000-0000-0000-0000-000000000007'::uuid, 5.00, 1)  -- Fusion Kitchen
) as v(id, avg_stars, cnt)
where r.id = v.id;

update public.couriers c set rating_avg = v.avg_stars, rating_count = v.cnt
from (values
  ('c1000000-0000-0000-0000-000000000001'::uuid, 5.00, 2), -- Vlad Ciobanu
  ('c1000000-0000-0000-0000-000000000002'::uuid, 5.00, 1), -- Nicolae Bejan
  ('c1000000-0000-0000-0000-000000000003'::uuid, 3.00, 1), -- Dumitru Rusnac
  ('c1000000-0000-0000-0000-000000000006'::uuid, 4.00, 1), -- Veaceslav Munteanu
  ('c1000000-0000-0000-0000-000000000009'::uuid, 4.00, 1), -- Denis Covali
  ('c1000000-0000-0000-0000-000000000008'::uuid, 5.00, 1)  -- Radu Sandu
) as v(id, avg_stars, cnt)
where c.id = v.id;

-- ============================================================================
-- Payouts — a closed "paid" week + the current, still-open "pending" day.
-- ============================================================================
insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl, status, paid_at) values
  ('restaurant', 'd0000000-0000-0000-0000-000000000003', current_date - 7, current_date - 1, 1, 1580, 316.00, 1264.00, 'paid', now() - interval '1 day'),
  ('restaurant', 'd0000000-0000-0000-0000-000000000005', current_date - 7, current_date - 1, 1, 380, 76.00, 304.00, 'paid', now() - interval '1 day'),
  ('restaurant', 'd0000000-0000-0000-0000-000000000006', current_date - 7, current_date - 1, 1, 750, 150.00, 600.00, 'paid', now() - interval '1 day'),
  ('restaurant', 'd0000000-0000-0000-0000-000000000001', current_date - 7, current_date - 1, 1, 960, 192.00, 768.00, 'paid', now() - interval '1 day'),
  ('restaurant', '33333333-3333-3333-3333-333333333333', current_date - 7, current_date - 1, 1, 630, 126.00, 504.00, 'paid', now() - interval '1 day'),
  ('restaurant', 'd0000000-0000-0000-0000-000000000008', current_date, current_date, 1, 310, 62.00, 248.00, 'pending', null),
  ('courier', 'c1000000-0000-0000-0000-000000000001', current_date - 7, current_date - 1, 1, 70.00, 10.50, 59.50, 'paid', now() - interval '1 day'),
  ('courier', 'c1000000-0000-0000-0000-000000000002', current_date - 7, current_date - 1, 1, 50.00, 7.50, 42.50, 'paid', now() - interval '1 day'),
  ('courier', 'c1000000-0000-0000-0000-000000000003', current_date - 7, current_date - 1, 1, 38.00, 5.70, 32.30, 'paid', now() - interval '1 day'),
  ('courier', 'c1000000-0000-0000-0000-000000000009', current_date - 7, current_date - 1, 1, 40.00, 6.00, 34.00, 'paid', now() - interval '1 day'),
  ('courier', 'c1000000-0000-0000-0000-000000000008', current_date - 7, current_date - 1, 1, 60.00, 6.00, 54.00, 'paid', now() - interval '1 day'),
  ('courier', 'c1000000-0000-0000-0000-000000000006', current_date, current_date, 1, 60.00, 6.75, 53.25, 'pending', null);

-- ============================================================================
-- Payment intents — every status the check constraint allows.
-- ============================================================================
insert into public.payment_intents (order_id, amount_mdl, provider, provider_ref, status, created_at, updated_at) values
  ('e0000000-0000-0000-0000-000000000002', 425, 'mock', null, 'pending', now() - interval '19 minutes', now() - interval '19 minutes'),
  ('e0000000-0000-0000-0000-000000000003', 652, 'mock', null, 'failed', now() - interval '29 minutes', now() - interval '28 minutes'),
  ('e0000000-0000-0000-0000-000000000007', 1650, 'mock', 'mock_ref_g1', 'succeeded', now() - interval '6 days' + interval '2 minutes', now() - interval '6 days' + interval '3 minutes'),
  ('e0000000-0000-0000-0000-000000000010', 370, 'mock', 'mock_ref_j1', 'succeeded', now() - interval '3 hours' + interval '2 minutes', now() - interval '3 hours' + interval '3 minutes'),
  ('e0000000-0000-0000-0000-000000000011', 1000, 'mock', 'mock_ref_k1', 'succeeded', now() - interval '5 days' + interval '2 minutes', now() - interval '5 days' + interval '3 minutes'),
  ('e0000000-0000-0000-0000-000000000012', 690, 'mock', 'mock_ref_l1', 'succeeded', now() - interval '2 days' + interval '2 minutes', now() - interval '2 days' + interval '3 minutes'),
  ('e0000000-0000-0000-0000-000000000013', 435, 'mock', null, 'cancelled', now() - interval '2 hours' + interval '30 seconds', now() - interval '1 hour 59 minutes'),
  ('e0000000-0000-0000-0000-000000000014', 400, 'mock', null, 'failed', now() - interval '5 hours' + interval '2 minutes', now() - interval '5 hours' + interval '3 minutes'),
  ('e0000000-0000-0000-0000-000000000015', 475, 'mock', 'mock_ref_o1', 'refunded', now() - interval '3 hours' + interval '2 minutes', now() - interval '2 hours 5 minutes');

-- ============================================================================
-- Fraud flags (WS10) — one unreviewed live-ish, one reviewed/cleared, one old unreviewed.
-- ============================================================================
insert into public.fraud_flags (courier_id, kind, detail, created_at, reviewed_at, reviewed_by) values
  ('c1000000-0000-0000-0000-000000000004', 'gps_teleport',
   '{"distance_km": 45.2, "elapsed_s": 120, "speed_kmh": 226, "order_id": "e0000000-0000-0000-0000-000000000004"}'::jsonb,
   now() - interval '40 minutes', null, null),
  ('c1000000-0000-0000-0000-000000000003', 'gps_teleport',
   '{"distance_km": 30.5, "elapsed_s": 180, "speed_kmh": 183}'::jsonb,
   now() - interval '2 days 5 hours', now() - interval '2 days 4 hours', 'a0000000-0000-0000-0000-000000000004'),
  ('c1000000-0000-0000-0000-000000000007', 'gps_teleport',
   '{"distance_km": 25.0, "elapsed_s": 200, "speed_kmh": 168}'::jsonb,
   now() - interval '8 days', null, null);

-- ============================================================================
-- Notification outbox samples (some already drained, some still pending).
-- Triggers also auto-enqueue for the live offer (order C) and the one order
-- that inserted directly at pending_restaurant against a staffed restaurant.
-- ============================================================================
insert into public.notification_outbox (user_id, title, body, url, tag, created_at, sent_at) values
  ('a0000000-0000-0000-0000-000000000003', 'Comandă nouă 🔔', 'Sakura Sushi · comandă catering', '/restaurant/catering', 'neworder:demo1', now() - interval '2 hours', now() - interval '2 hours' + interval '5 seconds'),
  ('c0000000-0000-0000-0000-000000000004', 'Comandă de livrat 🛵', 'Amber Bistro · comandă atribuită', '/deliveries', 'offer:demo1', now() - interval '9 minutes', now() - interval '9 minutes' + interval '5 seconds'),
  ('a0000000-0000-0000-0000-000000000001', 'Comanda a fost livrată ✅', 'Osaka House · comanda ta a ajuns', '/orders', 'delivered:demo1', now() - interval '2 days' + interval '71 minutes', now() - interval '2 days' + interval '71 minutes' + interval '5 seconds'),
  ('c0000000-0000-0000-0000-000000000008', 'Comandă de livrat 🛵', 'Fusion Kitchen · comandă nouă', '/deliveries', 'offer:demo2', now() - interval '20 seconds', null);

-- ============================================================================
-- Onboarding applications — pending / approved / rejected, both applicant types.
-- ============================================================================
insert into public.onboarding_applications (user_id, applicant_type, status, full_name, phone, email, details, review_note, reviewed_by, reviewed_at, created_at) values
  ('b0000000-0000-0000-0000-000000000004', 'courier', 'pending', 'Ion Crețu', '+37369300001', 'ion.cretu@test.md',
   '{"vehicle_type": "e_bike"}'::jsonb, null, null, null, now() - interval '1 day'),
  (null, 'restaurant', 'pending', 'Taverna Vale SRL', '+37369300002', 'contact@tavernavale.md',
   '{"name": "Taverna Vale", "cuisine_type": "other", "address": "Str. Florilor 12", "sector": "Ciocana"}'::jsonb, null, null, null, now() - interval '2 days'),
  (null, 'courier', 'approved', 'Cezar Munteanu', '+37369300003', 'cezar.munteanu@test.md',
   '{"vehicle_type": "car"}'::jsonb, 'Documente complete, aprobat.', 'a0000000-0000-0000-0000-000000000004', now() - interval '10 days', now() - interval '12 days'),
  (null, 'restaurant', 'rejected', 'Fast Food Express SRL', '+37369300004', 'contact@fastfoodexpress.md',
   '{"name": "Fast Food Express"}'::jsonb, 'Nu îndeplinește criteriile sanitare.', 'a0000000-0000-0000-0000-000000000004', now() - interval '6 days', now() - interval '9 days'),
  (null, 'courier', 'rejected', 'Ruslan Toma', '+37369300005', 'ruslan.toma@test.md',
   '{"vehicle_type": "scooter"}'::jsonb, 'Fără permis de conducere valabil.', 'a0000000-0000-0000-0000-000000000004', now() - interval '4 days', now() - interval '5 days');
