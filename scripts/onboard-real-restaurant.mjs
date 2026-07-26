#!/usr/bin/env node
// G2 — real-restaurant onboarding PROOF + repeatable harness.
//
// Onboards ONE real Chișinău restaurant into the LOCAL Supabase db, geocoding its
// REAL street address through the same Nominatim service the product's
// createRestaurant Server Action uses. This is proof-of-work that the geocoding
// pipeline resolves a real address to a real position and produces an orderable
// restaurant (real coords → dispatch + nearby-browse work, not the 6 km fallback).
//
// LOCAL ONLY. Never targets the shared prod project. The menu prices are
// representative for the pilot demo — confirm real prices with the partner at
// real onboarding.
//
// Run: node scripts/onboard-real-restaurant.mjs
// Requires: local Supabase up (container supabase_db_chisinau-delivery).

import { execFileSync } from "node:child_process";

const DB_CONTAINER = "supabase_db_chisinau-delivery";

// A real, verifiable Chișinău fine-dining restaurant (real name + real address).
const RESTAURANT = {
  id: "aa000000-0000-0000-0000-0000000000aa",
  name: "Vatra Neamului",
  slug: "vatra-neamului",
  cuisine_type: "fine_dining",
  address: "Strada București 67",
  sector: "Centru",
  phone: "+373 22 123456",
  delivery_fee_mdl: 40,
  min_order_amount_mdl: 150,
};

const CATEGORIES = [
  { id: "aa000000-0000-0000-0000-0000000000c1", name: "Supe & Aperitive", sort: 0 },
  { id: "aa000000-0000-0000-0000-0000000000c2", name: "Feluri principale", sort: 1 },
  { id: "aa000000-0000-0000-0000-0000000000c3", name: "Deserturi", sort: 2 },
];

// Representative Moldovan fine-dining menu (prices for the pilot demo).
const ITEMS = [
  { cat: 0, name: "Zeamă de pui", desc: "Supă tradițională de pui cu tăiței de casă", price: 85, sort: 0 },
  { cat: 0, name: "Plăcinte cu brânză (4 buc.)", desc: "Plăcinte moldovenești coapte, cu brânză sărată", price: 90, sort: 1 },
  { cat: 1, name: "Mămăligă cu brânză și smântână", desc: "Mămăligă fierbinte, brânză de oi, smântână", price: 95, sort: 0 },
  { cat: 1, name: "Sarmale în foi de viță", desc: "Sarmale cu carne și orez, în foi de viță", price: 130, sort: 1 },
  { cat: 1, name: "Friptură de porc la cuptor", desc: "Friptură cu cartofi copți și legume", price: 185, sort: 2 },
  { cat: 2, name: "Papanași cu vișine", desc: "Papanași pufoși cu smântână și dulceață de vișine", price: 110, sort: 0 },
];

async function geocode(address, city = "Chișinău") {
  const query = `${address}, ${city}, Moldova`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=md&addressdetails=1`;
  const res = await fetch(url, { headers: { "User-Agent": "chisinau-delivery/1.0 (restaurant onboarding geocoder)", Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error("no geocode result");
  const lat = Number(data[0].lat);
  const lng = Number(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("bad coords");
  if (lat < 45.4 || lat > 48.5 || lng < 26.6 || lng > 30.2) throw new Error(`coords outside Moldova: ${lat},${lng}`);
  return { lat, lng, displayName: data[0].display_name };
}

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  });
}

function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

async function main() {
  console.log(`Geocoding REAL address: "${RESTAURANT.address}, ${RESTAURANT.sector}, Chișinău" …`);
  const geo = await geocode(RESTAURANT.address);
  console.log(`  ✓ ${geo.lat}, ${geo.lng}`);
  console.log(`    ${geo.displayName}`);

  const r = RESTAURANT;
  let sql = "begin;\n";
  // idempotent: a fresh onboarding has no orders, so a clean delete-by-id is safe.
  sql += `delete from public.restaurants where id = ${q(r.id)};\n`;
  sql += `insert into public.restaurants (id, name, slug, cuisine_type, address, sector, phone, delivery_fee_mdl, min_order_amount_mdl, lat, lng, is_active)
    values (${q(r.id)}, ${q(r.name)}, ${q(r.slug)}, ${q(r.cuisine_type)}, ${q(r.address)}, ${q(r.sector)}, ${q(r.phone)}, ${r.delivery_fee_mdl}, ${r.min_order_amount_mdl}, ${geo.lat}, ${geo.lng}, true);\n`;

  for (const c of CATEGORIES) {
    sql += `insert into public.menu_categories (id, restaurant_id, name, sort_order) values (${q(c.id)}, ${q(r.id)}, ${q(c.name)}, ${c.sort});\n`;
  }
  for (const it of ITEMS) {
    sql += `insert into public.menu_items (restaurant_id, category_id, name, description, price_mdl, is_available, is_catering_only, sort_order)
      values (${q(r.id)}, ${q(CATEGORIES[it.cat].id)}, ${q(it.name)}, ${q(it.desc)}, ${it.price}, true, false, ${it.sort});\n`;
  }
  // Open daily 10:00–23:00.
  for (let d = 0; d <= 6; d++) {
    sql += `insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed) values (${q(r.id)}, ${d}, '10:00', '23:00', false);\n`;
  }
  sql += "commit;\n";

  psql(sql);
  console.log(`\n✓ Onboarded "${r.name}" (${r.slug}) — ${CATEGORIES.length} categories, ${ITEMS.length} items, open daily, is_active=true.`);

  // Proof it's discoverable by REAL distance: query nearby_restaurants from a
  // central-Chișinău point and show THIS restaurant with a real, non-fallback distance.
  const near = psql(
    `select round((n.distance_m/1000.0)::numeric, 2) || ' km from (47.0245, 28.8322)' as real_distance
       from public.nearby_restaurants(47.0245, 28.8322, 15, 50) n
      where n.id = ${q(r.id)};`,
  );
  console.log("\nnearby_restaurants proof — real distance (NOT the 6 km fallback):");
  console.log(near.trim());
}

main().catch((e) => {
  console.error("ONBOARD FAILED:", e.message);
  process.exit(1);
});
