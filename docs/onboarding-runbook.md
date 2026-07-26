# Restaurant onboarding runbook (Wave G2)

How a real restaurant goes from "signed up" to "taking real deliveries", with the
one thing the pilot was missing: a **real geographic position** so dispatch scoring
and nearby-browse work off the actual location instead of the 6 km fallback.

## The geocoding pipeline

`src/lib/geo/geocode.ts` → `geocodeAddress(address, city = "Chișinău")`:

- Calls **Nominatim** (OpenStreetMap) — free, no API key. `q="<address>, Chișinău,
  Moldova"`, `countrycodes=md`, `limit=1`.
- **Server-only** (the address never leaves the browser). Sets the required
  identifying `User-Agent`; onboarding is occasional so we stay under Nominatim's
  ~1 req/sec limit.
- **Moldova bounds clamp** (45.4–48.5 N, 26.6–30.2 E): a hit outside these is a
  geocoder miss, not a Chișinău restaurant → returns `null`.
- **Soft-fail by design**: any failure (no match, network, timeout, bad payload)
  returns `null`. Geocoding must NEVER block onboarding.

Unit-tested in `tests/unit/geocode.test.ts` (valid hit, no match, out-of-bounds
reject, non-OK HTTP, network failure, non-numeric coords).

## Product flow (auto-geocode on create)

`createRestaurant` (`src/app/(admin)/platform/restaurants/actions.ts`) auto-geocodes
the address and writes `restaurants.lat/lng` on insert. The operator sees the
outcome inline:

- ✅ `Restaurant creat. Adresă geolocalizată: 47.02026, 28.82941.`
- ⚠️ `Restaurant creat, dar adresa nu a putut fi geolocalizată automat — setează
  coordonatele manual înainte de activare.`

### Operator steps
1. **Platform → Onboardare restaurant nou**: name, unique slug, cuisine type,
   address (street + number, e.g. `Strada București 67`), sector, phone, delivery
   fee, min order. Submit.
2. Read the notice. If geolocated, the pin is set. If not, fix the address wording
   (street + number) and re-create, or set `lat/lng` by hand before activating.
3. Add the menu (categories + items with MDL prices) and weekly hours.
4. **Activate** the restaurant (the moderation toggle) — it's created inactive and
   is invisible + order-blocked until an admin flips `is_active`.

## Bulk / proof harness

`scripts/onboard-real-restaurant.mjs` — geocodes a real address through the SAME
Nominatim service and inserts a full restaurant (categories + items + daily hours +
coords + `is_active`) into the **LOCAL** db. Repeatable; **local-only** (never the
shared prod project). Prices are representative for the pilot demo — confirm real
prices with the partner at real onboarding.

```
node scripts/onboard-real-restaurant.mjs   # requires local Supabase up
```

## Verified proof (2026-07-26)

Onboarded **Vatra Neamului**, a real Chișinău fine-dining restaurant, real address
**Strada București 67**:

- Geocode (real Nominatim call) → **47.0202637, 28.8294149**
  (`67, Strada București, sectorul Centru, Chișinău, MD-2042`).
- `nearby_restaurants(47.0245, 28.8322, …)` returns it at **0.52 km** — a real
  distance, NOT the 6 km fallback → coords are wired into dispatch + browse.
- Live: appears in `/restaurants`, menu renders at `/restaurants/vatra-neamului`
  (6 items, real prices), and a `place_order` succeeds (pending_restaurant, 210 MDL).

## Going live (Wave G1 — separate, needs explicit OK)

Everything above is **local**. Pushing the schema + a real restaurant to the shared
prod project `rdowjxnuyawhrjppxzuu` is a deliberate pre-launch step that requires
explicit user approval (shared with dormant Trade-AI tables — never touch
`poly_*`/`gladiator*`/`equity_history`).
