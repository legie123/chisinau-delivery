-- Rich demo dataset (1/4): 8 new restaurants across Chișinău sectors + deep
-- menus (new restaurants + extra categories/items on the original 3), so
-- cross-restaurant dish search and every restaurant surface has real depth.
-- Idempotent-ish: fixed ids for restaurants only; categories/items use
-- gen_random_uuid() (safe to re-run on a fresh `db reset`, not designed for
-- double-apply on an already-seeded db).

-- ============================================================================
-- New restaurants
-- ============================================================================
insert into public.restaurants
  (id, slug, name, cuisine_type, description, address, sector, phone, accepts_catering,
   delivery_fee_mdl, min_order_amount_mdl, catering_min_amount_mdl, avg_prep_minutes,
   accept_sla_minutes, lat, lng, cover_photo_url)
values
  ('d0000000-0000-0000-0000-000000000001', 'sushi-yama', 'Sushi Yama', 'sushi',
   'Sushi de cartier, roluri generoase și seturi pentru familie.', 'Str. Independenței 21', 'Botanica', '+37360000004',
   true, 40, 200, 3000, 32, 6, 47.001000, 28.852000,
   'https://images.unsplash.com/photo-1553621042-f6e147245754?w=800&h=400&fit=crop'),
  ('d0000000-0000-0000-0000-000000000002', 'amber-bistro', 'Amber Bistro', 'fine_dining',
   'Bucătărie europeană modernă, ingrediente locale de sezon.', 'Str. Kiev 15', 'Râșcani', '+37360000005',
   true, 55, 350, 4500, 40, 8, 47.068000, 28.860000,
   'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=400&fit=crop'),
  ('d0000000-0000-0000-0000-000000000003', 'nobu-chisinau', 'Nobu Chișinău', 'sushi',
   'Omakase și roluri semnătură, experiență japoneză premium.', 'Bd. Ștefan cel Mare 182', 'Centru', '+37360000006',
   true, 70, 500, 6000, 40, 10, 47.023000, 28.835000,
   'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=800&h=400&fit=crop'),
  ('d0000000-0000-0000-0000-000000000004', 'ciocana-grill-house', 'Ciocana Grill House', 'other',
   'Grătar tradițional moldovenesc, porții generoase.', 'Str. Mihail Sadoveanu 5', 'Ciocana', '+37360000007',
   false, 35, 180, null, 28, 6, 47.033000, 28.904000,
   'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&h=400&fit=crop'),
  ('d0000000-0000-0000-0000-000000000005', 'le-petit-chef', 'Le Petit Chef', 'fine_dining',
   'Bistro franțuzesc de cartier, clasici revizitați.', 'Str. N. Zelinski 40', 'Telecentru', '+37360000008',
   true, 50, 300, 4000, 38, 7, 46.998000, 28.795000,
   'https://images.unsplash.com/photo-1424847651672-bf20a4b0982b?w=800&h=400&fit=crop'),
  ('d0000000-0000-0000-0000-000000000006', 'bamboo-roll', 'Bamboo Roll', 'sushi',
   'Roluri proaspete, livrare rapidă în Buiucani.', 'Str. Calea Ieșilor 8', 'Buiucani', '+37360000009',
   false, 38, 180, null, 30, 6, 47.041000, 28.802000,
   'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=800&h=400&fit=crop'),
  ('d0000000-0000-0000-0000-000000000007', 'fusion-kitchen', 'Fusion Kitchen', 'other',
   'Asian fusion — thai, vietnamez și japonez, într-un singur meniu.', 'Str. Alecu Russo 30', 'Râșcani', '+37360000010',
   true, 42, 220, 3200, 33, 7, 47.053000, 28.871000,
   'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=800&h=400&fit=crop'),
  ('d0000000-0000-0000-0000-000000000008', 'osteria-roma', 'Osteria Roma', 'other',
   'Trattorie italiană autentică, paste proaspete zilnic.', 'Str. Columna 65', 'Centru', '+37360000011',
   false, 45, 250, null, 30, 7, 47.018000, 28.828000,
   'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&h=400&fit=crop');

insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at)
select r.id, d, '11:00', '22:00'
from public.restaurants r, generate_series(0, 6) as d
where r.slug in ('sushi-yama', 'amber-bistro', 'nobu-chisinau', 'ciocana-grill-house',
                  'le-petit-chef', 'bamboo-roll', 'fusion-kitchen', 'osteria-roma');

-- ============================================================================
-- Sushi Yama — menu
-- ============================================================================
with cat as (
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    ('d0000000-0000-0000-0000-000000000001', 'Seturi', 1),
    ('d0000000-0000-0000-0000-000000000001', 'Roluri Clasice', 2),
    ('d0000000-0000-0000-0000-000000000001', 'Roluri Speciale', 3),
    ('d0000000-0000-0000-0000-000000000001', 'Nigiri & Sashimi', 4),
    ('d0000000-0000-0000-0000-000000000001', 'Supe & Salate', 5),
    ('d0000000-0000-0000-0000-000000000001', 'Platouri Catering', 6)
  returning id, name
)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, is_catering_only, catering_min_qty, sort_order)
select 'd0000000-0000-0000-0000-000000000001', cat.id, v.name, v.description, v.price, v.photo, v.avail, v.cat_only, v.min_qty, v.sort
from cat join (values
  ('Seturi', 'Set Yama 20 piese', 'Nigiri, sashimi și roluri asortate.', 480, 'https://images.unsplash.com/photo-1583623025817-d180a2221d0a?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Seturi', 'Set Yama Deluxe 40 piese', 'Selecție extinsă pentru 3-4 persoane.', 890, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Clasice', 'California Roll', 'Crab, avocado, castravete.', 175, 'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Roluri Clasice', 'Philadelphia Roll', 'Somon, cream cheese, avocado.', 205, 'https://images.unsplash.com/photo-1611143669185-af224c5e3252?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Clasice', 'Kappa Maki', 'Castravete, susan.', 120, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Roluri Clasice', 'Tekka Maki', 'Ton proaspăt.', 160, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', false, false, null::int, 4),
  ('Roluri Speciale', 'Yama Dragon Roll', 'Anghilă la grătar, avocado, sos unagi.', 240, 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Roluri Speciale', 'Rainbow Roll', 'Somon, ton, avocado, crab.', 260, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Speciale', 'Volcano Roll', 'Crab copt, maioneză picantă.', 230, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Roluri Speciale', 'Tempura Roll', 'Creveți tempura, avocado, sos spicy.', 235, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', true, false, null::int, 4),
  ('Nigiri & Sashimi', 'Nigiri Somon (2 buc)', 'Orez, somon proaspăt.', 95, 'https://images.unsplash.com/photo-1583623025817-d180a2221d0a?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Nigiri & Sashimi', 'Nigiri Ton (2 buc)', 'Orez, ton proaspăt.', 105, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Nigiri & Sashimi', 'Sashimi Somon 8 felii', 'Somon proaspăt tăiat fin.', 260, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Supe & Salate', 'Supă Miso', 'Tofu, wakame, ceapă verde.', 85, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Supe & Salate', 'Salată Chuka Wakame', 'Alge marinate, susan.', 95, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Platouri Catering', 'Platou Yama Eveniment 80 piese', 'Pentru petreceri și evenimente corporate.', 3200, 'https://images.unsplash.com/photo-1625938145312-c18b02a4a913?w=400&h=400&fit=crop', true, true, 1, 1)
) as v(catname, name, description, price, photo, avail, cat_only, min_qty, sort)
on cat.name = v.catname;

-- ============================================================================
-- Amber Bistro — menu
-- ============================================================================
with cat as (
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    ('d0000000-0000-0000-0000-000000000002', 'Aperitive', 1),
    ('d0000000-0000-0000-0000-000000000002', 'Feluri Principale', 2),
    ('d0000000-0000-0000-0000-000000000002', 'Garnituri', 3),
    ('d0000000-0000-0000-0000-000000000002', 'Deserturi', 4),
    ('d0000000-0000-0000-0000-000000000002', 'Meniuri Eveniment', 5)
  returning id, name
)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, is_catering_only, catering_min_qty, sort_order)
select 'd0000000-0000-0000-0000-000000000002', cat.id, v.name, v.description, v.price, v.photo, v.avail, v.cat_only, v.min_qty, v.sort
from cat join (values
  ('Aperitive', 'Tartar de vită', 'Vită Angus, capere, gălbenuș.', 220, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Aperitive', 'Supă cremă de dovleac', 'Cu semințe caramelizate.', 110, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Aperitive', 'Foie gras poêlé', 'Cu compot de piersici.', 260, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Feluri Principale', 'Magret de rață', 'Cu piure de țelină și sos de portocale.', 340, 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Feluri Principale', 'File de vită Wellington', 'Cu sos de trufe.', 420, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Feluri Principale', 'Somon la grătar', 'Cu legume de sezon.', 290, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Feluri Principale', 'Risotto cu ciuperci porcini', 'Parmezan, ulei de trufe.', 260, 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=400&h=400&fit=crop', false, false, null::int, 4),
  ('Feluri Principale', 'Pui la cuptor cu ierburi de Provence', 'Cartofi rustici, usturoi confiat.', 250, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 5),
  ('Aperitive', 'Carpaccio de vită', 'Rucola, parmezan, ulei de măsline.', 200, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', true, false, null::int, 4),
  ('Garnituri', 'Piure de cartofi cu unt', 'Cremos, unt de fermă.', 60, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Garnituri', 'Legume glazurate', 'Legume de sezon la abur.', 65, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Deserturi', 'Crème brûlée', 'Vanilie Madagascar.', 120, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Deserturi', 'Tarte Tatin', 'Cu mere caramelizate.', 130, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Deserturi', 'Fondant de ciocolată', 'Cu inimă lichidă.', 140, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Meniuri Eveniment', 'Meniu Eveniment Amber (10 persoane)', 'Meniu degustare pentru evenimente private.', 5200, 'https://images.unsplash.com/photo-1625938145312-c18b02a4a913?w=400&h=400&fit=crop', true, true, 1, 1)
) as v(catname, name, description, price, photo, avail, cat_only, min_qty, sort)
on cat.name = v.catname;

-- ============================================================================
-- Nobu Chișinău — menu
-- ============================================================================
with cat as (
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    ('d0000000-0000-0000-0000-000000000003', 'Seturi Omakase', 1),
    ('d0000000-0000-0000-0000-000000000003', 'Roluri Semnătură', 2),
    ('d0000000-0000-0000-0000-000000000003', 'Nigiri & Sashimi Premium', 3),
    ('d0000000-0000-0000-0000-000000000003', 'Supe & Salate', 4),
    ('d0000000-0000-0000-0000-000000000003', 'Deserturi', 5),
    ('d0000000-0000-0000-0000-000000000003', 'Platouri Catering', 6)
  returning id, name
)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, is_catering_only, catering_min_qty, sort_order)
select 'd0000000-0000-0000-0000-000000000003', cat.id, v.name, v.description, v.price, v.photo, v.avail, v.cat_only, v.min_qty, v.sort
from cat join (values
  ('Seturi Omakase', 'Omakase Nobu 12 feluri', 'Selecția bucătarului, sezonieră.', 1400, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Seturi Omakase', 'Set Premium Sashimi 30 piese', 'Ton, somon, hamachi, dorada.', 980, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Semnătură', 'Nobu Special Roll', 'Homar, avocado, trufe negre.', 380, 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Roluri Semnătură', 'Black Dragon Roll', 'Anghilă, caviar negru, unagi.', 320, 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Semnătură', 'Spicy Yellowtail Roll', 'Hamachi, ardei jalapeño.', 260, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Roluri Semnătură', 'Golden Roll', 'Crab, foaie fină de aur alimentar.', 350, 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=400&h=400&fit=crop', true, false, null::int, 4),
  ('Deserturi', 'Yuzu Sorbet', 'Citrice japoneze, prospețime.', 110, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Nigiri & Sashimi Premium', 'Nigiri Toro (2 buc)', 'Burtă de ton, delicatesă.', 180, 'https://images.unsplash.com/photo-1583623025817-d180a2221d0a?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Nigiri & Sashimi Premium', 'Sashimi Hamachi 6 felii', 'Tăiat fin, servit rece.', 220, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Nigiri & Sashimi Premium', 'Uni Nigiri (2 buc)', 'Arici de mare, delicatesă japoneză.', 260, 'https://images.unsplash.com/photo-1583623025817-d180a2221d0a?w=400&h=400&fit=crop', false, false, null::int, 3),
  ('Supe & Salate', 'Supă Miso cu Trufe', 'Ediție specială cu ulei de trufe.', 120, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Supe & Salate', 'Salată Kani', 'Crab, maioneză japoneză.', 140, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Deserturi', 'Mochi Asortate 6 buc', 'Orez glutinos, umpluturi variate.', 130, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Deserturi', 'Cheesecake Matcha', 'Ceai verde japonez.', 150, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Platouri Catering', 'Platou Omakase Corporate 100 piese', 'Pentru evenimente exclusiviste.', 5800, 'https://images.unsplash.com/photo-1625938145312-c18b02a4a913?w=400&h=400&fit=crop', true, true, 1, 1)
) as v(catname, name, description, price, photo, avail, cat_only, min_qty, sort)
on cat.name = v.catname;

-- ============================================================================
-- Ciocana Grill House — menu
-- ============================================================================
with cat as (
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    ('d0000000-0000-0000-0000-000000000004', 'Aperitive', 1),
    ('d0000000-0000-0000-0000-000000000004', 'Grătar', 2),
    ('d0000000-0000-0000-0000-000000000004', 'Garnituri', 3),
    ('d0000000-0000-0000-0000-000000000004', 'Salate', 4),
    ('d0000000-0000-0000-0000-000000000004', 'Deserturi', 5)
  returning id, name
)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, is_catering_only, catering_min_qty, sort_order)
select 'd0000000-0000-0000-0000-000000000004', cat.id, v.name, v.description, v.price, v.photo, v.avail, v.cat_only, v.min_qty, v.sort
from cat join (values
  ('Aperitive', 'Bruschete cu roșii', 'Pâine la grătar, roșii, busuioc.', 70, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Aperitive', 'Aripioare de pui picante', 'Sos picant de casă.', 95, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Grătar', 'Ceafă de porc la grătar', 'Cu sos barbecue.', 180, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Grătar', 'Mici tradiționali (6 buc)', 'Rețetă de casă.', 140, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Grătar', 'Cotlet de vită la grătar', 'Maturat, la cărbune.', 260, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Grătar', 'Frigărui de pui', 'Marinate, la jar.', 150, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 4),
  ('Grătar', 'Costiță de porc afumată', 'Afumată lent, glazură dulce-picantă.', 220, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', false, false, null::int, 5),
  ('Grătar', 'Somon la grătar', 'Cu lămâie și ierburi.', 240, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 6),
  ('Garnituri', 'Cartofi copți cu rozmarin', 'La cuptor, cu ierburi.', 70, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Garnituri', 'Legume la grătar', 'Ardei, dovlecei, vinete.', 65, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Salate', 'Salată de varză cu morcov', 'Clasică, oțet de mere.', 45, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Salate', 'Salată grecească', 'Feta, măsline, castraveți.', 90, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Salate', 'Salată de castraveți cu smântână', 'Prospețime de vară.', 40, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Deserturi', 'Clătite cu dulceață', 'Rețetă tradițională.', 75, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Deserturi', 'Papanași cu smântână', 'Cu dulceață de afine.', 95, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 2)
) as v(catname, name, description, price, photo, avail, cat_only, min_qty, sort)
on cat.name = v.catname;

-- ============================================================================
-- Le Petit Chef — menu
-- ============================================================================
with cat as (
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    ('d0000000-0000-0000-0000-000000000005', 'Aperitive', 1),
    ('d0000000-0000-0000-0000-000000000005', 'Feluri Principale', 2),
    ('d0000000-0000-0000-0000-000000000005', 'Garnituri', 3),
    ('d0000000-0000-0000-0000-000000000005', 'Deserturi', 4),
    ('d0000000-0000-0000-0000-000000000005', 'Meniuri Eveniment', 5)
  returning id, name
)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, is_catering_only, catering_min_qty, sort_order)
select 'd0000000-0000-0000-0000-000000000005', cat.id, v.name, v.description, v.price, v.photo, v.avail, v.cat_only, v.min_qty, v.sort
from cat join (values
  ('Aperitive', 'Supă de ceapă franțuzească', 'Gratinată cu gruyère.', 95, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Aperitive', 'Escargots de Bourgogne', 'Unt de usturoi și pătrunjel.', 180, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Aperitive', 'Salată Niçoise', 'Ton, ouă, măsline, fasole verde.', 130, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Feluri Principale', 'Coq au vin', 'Pui înăbușit în vin roșu.', 260, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Feluri Principale', 'Bouillabaisse', 'Supă de pește provensală.', 320, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Feluri Principale', 'Ratatouille cu piept de rață', 'Legume de sezon, piept de rață.', 290, 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Feluri Principale', 'Confit de rață', 'Cu cartofi la cuptor.', 270, 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop', false, false, null::int, 4),
  ('Feluri Principale', 'Cassoulet Toulousain', 'Fasole albă, cârnați, confit de rață.', 280, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 5),
  ('Aperitive', 'Terrine de rață', 'Cu gem de smochine.', 170, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', true, false, null::int, 4),
  ('Garnituri', 'Gratin dauphinois', 'Cartofi gratinați cu smântână.', 65, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Garnituri', 'Haricots verts cu unt', 'Fasole verde, unt, migdale.', 55, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Deserturi', 'Crème brûlée classique', 'Vanilie Madagascar.', 115, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Deserturi', 'Tarte au citron', 'Bezea italiană, lămâie proaspătă.', 120, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Deserturi', 'Profiterol', 'Cremă vanilie, sos de ciocolată.', 130, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Meniuri Eveniment', 'Meniu Degustare Le Petit Chef (8 persoane)', 'Meniu degustare pentru evenimente private.', 4200, 'https://images.unsplash.com/photo-1625938145312-c18b02a4a913?w=400&h=400&fit=crop', true, true, 1, 1)
) as v(catname, name, description, price, photo, avail, cat_only, min_qty, sort)
on cat.name = v.catname;

-- ============================================================================
-- Bamboo Roll — menu
-- ============================================================================
with cat as (
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    ('d0000000-0000-0000-0000-000000000006', 'Seturi', 1),
    ('d0000000-0000-0000-0000-000000000006', 'Roluri Clasice', 2),
    ('d0000000-0000-0000-0000-000000000006', 'Roluri Speciale', 3),
    ('d0000000-0000-0000-0000-000000000006', 'Supe & Salate', 4),
    ('d0000000-0000-0000-0000-000000000006', 'Deserturi', 5)
  returning id, name
)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, is_catering_only, catering_min_qty, sort_order)
select 'd0000000-0000-0000-0000-000000000006', cat.id, v.name, v.description, v.price, v.photo, v.avail, v.cat_only, v.min_qty, v.sort
from cat join (values
  ('Seturi', 'Set Bamboo 16 piese', 'Nigiri și roluri clasice.', 420, 'https://images.unsplash.com/photo-1583623025817-d180a2221d0a?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Seturi', 'Set Bamboo Family 32 piese', 'Pentru 2-3 persoane.', 780, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Clasice', 'California Roll', 'Crab, avocado, castravete.', 165, 'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Roluri Clasice', 'Philadelphia Roll', 'Somon, cream cheese, avocado.', 195, 'https://images.unsplash.com/photo-1611143669185-af224c5e3252?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Clasice', 'Kappa Maki', 'Castravete, susan.', 110, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Roluri Speciale', 'Bamboo Dragon Roll', 'Anghilă, avocado, sos unagi.', 220, 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Roluri Speciale', 'Ebi Tempura Roll', 'Creveți tempura crocanți.', 225, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Speciale', 'Spicy Salmon Roll', 'Somon picant, ceapă verde.', 210, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', false, false, null::int, 3),
  ('Roluri Speciale', 'Rainbow Roll', 'Somon, ton, avocado, crab.', 240, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 4),
  ('Roluri Clasice', 'Tekka Maki', 'Ton proaspăt.', 130, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', true, false, null::int, 4),
  ('Deserturi', 'Matcha Ice Cream', 'Ceai verde japonez, cremos.', 95, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Supe & Salate', 'Supă Miso', 'Tofu, wakame.', 80, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Supe & Salate', 'Salată Wakame', 'Alge marinate, susan.', 90, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Deserturi', 'Mochi 4 buc', 'Orez glutinos, umplutură de fructe.', 90, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Deserturi', 'Cheesecake Japonez', 'Textură pufoasă, ușor dulce.', 110, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 2)
) as v(catname, name, description, price, photo, avail, cat_only, min_qty, sort)
on cat.name = v.catname;

-- ============================================================================
-- Fusion Kitchen — menu
-- ============================================================================
with cat as (
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    ('d0000000-0000-0000-0000-000000000007', 'Aperitive', 1),
    ('d0000000-0000-0000-0000-000000000007', 'Feluri Principale', 2),
    ('d0000000-0000-0000-0000-000000000007', 'Bowl-uri', 3),
    ('d0000000-0000-0000-0000-000000000007', 'Deserturi', 4),
    ('d0000000-0000-0000-0000-000000000007', 'Platouri Catering', 5)
  returning id, name
)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, is_catering_only, catering_min_qty, sort_order)
select 'd0000000-0000-0000-0000-000000000007', cat.id, v.name, v.description, v.price, v.photo, v.avail, v.cat_only, v.min_qty, v.sort
from cat join (values
  ('Aperitive', 'Spring Rolls cu legume', 'Crocante, sos de chili dulce.', 90, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Aperitive', 'Gyoza cu pui (6 buc)', 'Aburite, sos de soia.', 110, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Aperitive', 'Edamame cu sare de mare', 'Boabe de soia aburite.', 70, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Feluri Principale', 'Pad Thai cu creveți', 'Tăiței de orez, arahide.', 220, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Feluri Principale', 'Ramen Tonkotsu', 'Supă de oase de porc, ou moale.', 250, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Feluri Principale', 'Wok de vită cu legume', 'Sos de stridii.', 260, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Feluri Principale', 'Curry Verde Thai cu pui', 'Lapte de cocos, bazilic thailandez.', 230, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=400&fit=crop', false, false, null::int, 4),
  ('Bowl-uri', 'Poke Bowl Somon', 'Orez, somon crud, avocado, edamame.', 210, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Bowl-uri', 'Poke Bowl Ton Picant', 'Ton crud picant, castraveți, susan.', 225, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Bowl-uri', 'Buddha Bowl Vegetarian', 'Quinoa, legume, hummus.', 180, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Bowl-uri', 'Teriyaki Chicken Bowl', 'Pui glazurat, orez, legume.', 215, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 4),
  ('Aperitive', 'Vietnamese Spring Rolls', 'Foi de orez, creveți, mentă.', 95, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 4),
  ('Deserturi', 'Mango Sticky Rice', 'Desert thailandez clasic.', 100, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Deserturi', 'Cheesecake cu Matcha', 'Ceai verde japonez.', 115, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Platouri Catering', 'Platou Fusion Eveniment', 'Selecție mixtă pentru evenimente.', 2900, 'https://images.unsplash.com/photo-1625938145312-c18b02a4a913?w=400&h=400&fit=crop', true, true, 1, 1)
) as v(catname, name, description, price, photo, avail, cat_only, min_qty, sort)
on cat.name = v.catname;

-- ============================================================================
-- Osteria Roma — menu
-- ============================================================================
with cat as (
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    ('d0000000-0000-0000-0000-000000000008', 'Aperitive', 1),
    ('d0000000-0000-0000-0000-000000000008', 'Paste', 2),
    ('d0000000-0000-0000-0000-000000000008', 'Feluri Principale', 3),
    ('d0000000-0000-0000-0000-000000000008', 'Deserturi', 4)
  returning id, name
)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, is_catering_only, catering_min_qty, sort_order)
select 'd0000000-0000-0000-0000-000000000008', cat.id, v.name, v.description, v.price, v.photo, v.avail, v.cat_only, v.min_qty, v.sort
from cat join (values
  ('Aperitive', 'Bruschetta al Pomodoro', 'Roșii, busuioc, usturoi.', 75, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Aperitive', 'Antipasto Misto', 'Mezeluri și brânzeturi italiene.', 160, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Aperitive', 'Carpaccio di Manzo', 'Vită, rucola, parmezan.', 190, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Paste', 'Spaghetti Carbonara', 'Guanciale, ou, pecorino.', 175, 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Paste', 'Tagliatelle al Tartufo', 'Cremă de trufe.', 260, 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Paste', 'Penne Arrabbiata', 'Sos picant de roșii.', 150, 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Paste', 'Lasagna della Casa', 'Rețetă tradițională de familie.', 190, 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=400&h=400&fit=crop', true, false, null::int, 4),
  ('Feluri Principale', 'Pizza Margherita', 'Mozzarella, busuioc, roșii.', 165, 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Feluri Principale', 'Pizza Quattro Formaggi', 'Patru brânzeturi italiene.', 210, 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Feluri Principale', 'Osso Buco alla Milanese', 'Cu risotto milanez.', 320, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Feluri Principale', 'Saltimbocca alla Romana', 'Vițel, prosciutto, salvie.', 280, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', false, false, null::int, 4),
  ('Feluri Principale', 'Pollo alla Parmigiana', 'Pui pane, sos de roșii, mozzarella.', 230, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', true, false, null::int, 5),
  ('Paste', 'Spaghetti alle Vongole', 'Scoici, usturoi, vin alb.', 240, 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=400&h=400&fit=crop', true, false, null::int, 5),
  ('Deserturi', 'Tiramisù', 'Rețetă clasică cu mascarpone.', 120, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Deserturi', 'Panna Cotta', 'Cu sos de fructe de pădure.', 110, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 2)
) as v(catname, name, description, price, photo, avail, cat_only, min_qty, sort)
on cat.name = v.catname;

-- ============================================================================
-- Deepen the original 3 restaurants with additional categories/items
-- ============================================================================

-- Sakura Sushi — new categories
with cat as (
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    ('11111111-1111-1111-1111-111111111111', 'Nigiri & Sashimi', 3),
    ('11111111-1111-1111-1111-111111111111', 'Supe & Salate', 4),
    ('11111111-1111-1111-1111-111111111111', 'Roluri Speciale', 5),
    ('11111111-1111-1111-1111-111111111111', 'Deserturi', 6)
  returning id, name
)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, is_catering_only, catering_min_qty, sort_order)
select '11111111-1111-1111-1111-111111111111', cat.id, v.name, v.description, v.price, v.photo, v.avail, v.cat_only, v.min_qty, v.sort
from cat join (values
  ('Nigiri & Sashimi', 'Nigiri Somon (2 buc)', 'Orez, somon proaspăt.', 90, 'https://images.unsplash.com/photo-1583623025817-d180a2221d0a?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Nigiri & Sashimi', 'Nigiri Ton (2 buc)', 'Orez, ton proaspăt.', 100, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Nigiri & Sashimi', 'Sashimi Somon 6 felii', 'Somon proaspăt tăiat fin.', 210, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Supe & Salate', 'Supă Miso', 'Tofu, wakame.', 80, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Supe & Salate', 'Salată Wakame', 'Alge marinate, susan.', 85, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Speciale', 'Sakura Dragon Roll', 'Anghilă, avocado, sos unagi.', 235, 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Roluri Speciale', 'Rainbow Roll', 'Somon, ton, avocado, crab.', 250, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Speciale', 'Spicy Tuna Roll', 'Ton picant, castravete.', 195, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Roluri Speciale', 'Tempura Roll', 'Creveți tempura, sos spicy.', 220, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', false, false, null::int, 4),
  ('Deserturi', 'Mochi Asortate', 'Orez glutinos, umpluturi variate.', 110, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Deserturi', 'Cheesecake Matcha', 'Ceai verde japonez.', 120, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', true, false, null::int, 2)
) as v(catname, name, description, price, photo, avail, cat_only, min_qty, sort)
on cat.name = v.catname;

-- Sakura Sushi — extra items on the two ORIGINAL categories (seed.sql)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, sort_order)
select '11111111-1111-1111-1111-111111111111', mc.id, v.name, v.description, v.price, v.photo, true, v.sort
from public.menu_categories mc
join (values
  ('Roluri', 'Kappa Maki', 'Castravete, susan.', 120, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', 3),
  ('Roluri', 'Tekka Maki', 'Ton proaspăt.', 150, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', 4),
  ('Roluri', 'Volcano Roll', 'Crab copt, maioneză picantă.', 230, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', 5),
  ('Roluri', 'Ebi Tempura Roll', 'Creveți tempura crocanți.', 235, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', 6),
  ('Seturi', 'Set Sakura Deluxe 40 piese', 'Selecție extinsă pentru 3-4 persoane.', 890, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', 2)
) as v(catname, name, description, price, photo, sort)
on mc.restaurant_id = '11111111-1111-1111-1111-111111111111' and mc.name = v.catname;

-- Le Jardin — new categories
with cat as (
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    ('22222222-2222-2222-2222-222222222222', 'Aperitive', 3),
    ('22222222-2222-2222-2222-222222222222', 'Garnituri', 4),
    ('22222222-2222-2222-2222-222222222222', 'Meniuri Eveniment', 5)
  returning id, name
)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, is_catering_only, catering_min_qty, sort_order)
select '22222222-2222-2222-2222-222222222222', cat.id, v.name, v.description, v.price, v.photo, v.avail, v.cat_only, v.min_qty, v.sort
from cat join (values
  ('Aperitive', 'Tartar de vită', 'Vită Angus, capere, gălbenuș.', 210, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Aperitive', 'Supă cremă de sparanghel', 'Cu crutoane de casă.', 100, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Aperitive', 'Foie gras poêlé', 'Cu compot de piersici.', 250, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Aperitive', 'Salată Niçoise', 'Ton, ouă, măsline, fasole verde.', 130, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 4),
  ('Garnituri', 'Piure de cartofi cu unt', 'Cremos, unt de fermă.', 60, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Garnituri', 'Legume glazurate', 'Legume de sezon la abur.', 65, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Meniuri Eveniment', 'Meniu Eveniment Le Jardin (10 persoane)', 'Meniu degustare pentru evenimente private.', 4800, 'https://images.unsplash.com/photo-1625938145312-c18b02a4a913?w=400&h=400&fit=crop', true, true, 1, 1)
) as v(catname, name, description, price, photo, avail, cat_only, min_qty, sort)
on cat.name = v.catname;

-- Le Jardin — extra items on ORIGINAL categories (seed.sql: "Feluri principale", "Deserturi")
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, sort_order)
select '22222222-2222-2222-2222-222222222222', mc.id, v.name, v.description, v.price, v.photo, true, v.sort
from public.menu_categories mc
join (values
  ('Feluri principale', 'File de vită Wellington', 'Cu sos de trufe.', 420, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=400&fit=crop', 2),
  ('Feluri principale', 'Somon la grătar', 'Cu legume de sezon.', 290, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', 3),
  ('Feluri principale', 'Risotto cu ciuperci porcini', 'Parmezan, ulei de trufe.', 260, 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=400&h=400&fit=crop', 4),
  ('Deserturi', 'Tarte Tatin', 'Cu mere caramelizate.', 130, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', 2),
  ('Deserturi', 'Fondant de ciocolată', 'Cu inimă lichidă.', 140, 'https://images.unsplash.com/photo-1470324161839-ce2bb6fa6bc3?w=400&h=400&fit=crop', 3),
  ('Feluri principale', 'Homar la grătar', 'Cu unt de ierburi.', 480, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop', 5)
) as v(catname, name, description, price, photo, sort)
on mc.restaurant_id = '22222222-2222-2222-2222-222222222222' and mc.name = v.catname;

-- Osaka House — new categories (accepts_catering = false: no catering category)
with cat as (
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    ('33333333-3333-3333-3333-333333333333', 'Nigiri & Sashimi', 2),
    ('33333333-3333-3333-3333-333333333333', 'Supe & Salate', 3),
    ('33333333-3333-3333-3333-333333333333', 'Roluri Speciale', 4)
  returning id, name
)
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, is_catering_only, catering_min_qty, sort_order)
select '33333333-3333-3333-3333-333333333333', cat.id, v.name, v.description, v.price, v.photo, v.avail, v.cat_only, v.min_qty, v.sort
from cat join (values
  ('Nigiri & Sashimi', 'Nigiri Somon (2 buc)', 'Orez, somon proaspăt.', 90, 'https://images.unsplash.com/photo-1583623025817-d180a2221d0a?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Nigiri & Sashimi', 'Nigiri Ton (2 buc)', 'Orez, ton proaspăt.', 95, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Nigiri & Sashimi', 'Sashimi Somon 6 felii', 'Somon proaspăt tăiat fin.', 200, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Supe & Salate', 'Supă Miso', 'Tofu, wakame.', 75, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Supe & Salate', 'Salată Wakame', 'Alge marinate, susan.', 80, 'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Speciale', 'Osaka Dragon Roll', 'Anghilă, avocado, sos unagi.', 225, 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=400&h=400&fit=crop', true, false, null::int, 1),
  ('Roluri Speciale', 'Rainbow Roll', 'Somon, ton, avocado, crab.', 245, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop', true, false, null::int, 2),
  ('Roluri Speciale', 'Volcano Roll', 'Crab copt, maioneză picantă.', 215, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', true, false, null::int, 3),
  ('Roluri Speciale', 'Ebi Tempura Roll', 'Creveți tempura crocanți.', 225, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', false, false, null::int, 4)
) as v(catname, name, description, price, photo, avail, cat_only, min_qty, sort)
on cat.name = v.catname;

-- Osaka House — extra items on ORIGINAL category (seed.sql: "Roluri clasice")
insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, photo_url, is_available, sort_order)
select '33333333-3333-3333-3333-333333333333', mc.id, v.name, v.description, v.price, v.photo, true, v.sort
from public.menu_categories mc
join (values
  ('Roluri clasice', 'California Roll', 'Crab, avocado, castravete.', 170, 'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=400&h=400&fit=crop', 3),
  ('Roluri clasice', 'Philadelphia Roll', 'Somon, cream cheese, avocado.', 200, 'https://images.unsplash.com/photo-1611143669185-af224c5e3252?w=400&h=400&fit=crop', 4),
  ('Roluri clasice', 'Kappa Maki', 'Castravete, susan.', 115, 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400&h=400&fit=crop', 5),
  ('Roluri Speciale', 'Tempura Roll', 'Creveți tempura, sos spicy.', 230, 'https://images.unsplash.com/photo-1607301405390-d831c242f59b?w=400&h=400&fit=crop', 5)
) as v(catname, name, description, price, photo, sort)
on mc.restaurant_id = '33333333-3333-3333-3333-333333333333' and mc.name = v.catname;
