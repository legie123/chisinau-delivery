# HANDOFF — CLIENT (mobile/client în Expo Go + web (customer))

> Starea sectorului, scrisă de sesiunea CLIENT. Reguli comune: HANDOFF-ADMIN.md §1–4, NUCLEU, stratul de interconectare.
> Deține: `mobile/client/**`, `src/app/(customer)/**` (fără `orders/page.tsx`, necomis al userului), `src/components/customer/**`,
> RPC: `place_order`, `set_order_tip`, `submit_rating`, discovery/căutare, adrese. Migrații `0001NN`, sim-uri 100–149.

## Rulare (Expo Go pe iPhone)
- Tunel: `bash scripts/mobile/tunnel.sh 90` (scrie `mobile/.tunnel.env`, expiră după 90 min) → probă: REST/auth 200, `/pg` 404.
- Metro cu Node ≥ 20.19 (Homebrew primul în PATH): `set -a; . mobile/.tunnel.env; set +a; cd mobile/client && npx expo start --go --lan --port 8082 --clear`.
- QR: `exp://192.168.1.34:8082`. Bundle-ul iOS se poate verifica fără telefon: manifest cu `expo-platform: ios`, apoi `launchAsset.url` → 200.

## Gate-uri NUCLEU (CLIENT)
| gate | stare | dovadă |
|---|---|---|
| 1 cheia Maps în config-ul public | DONE `89b9289` | `npm run check:config`: înainte „present 1x”, după 0; prebuild Android: cheia-santinelă în AndroidManifest |
| 2 afișat = încasat = ledger | DONE `4666f13`, `76e3338` | sim 100 (+mutație); `npm run test:price` 200/200 (160 livrări + 40 derive refuzate); mutație: total fără taxă → roșu |
| 3 matrice de paritate | ÎN LUCRU | agent de explorare (rezultatul intră aici) |
| 4 construcție PARTIAL/LIPSĂ | ÎN LUCRU | Epuizat `92b98c3`+`7ea7186`; C1 pin + rază `7ab3524`, `41f6735`, `b19a656`, `70d9288` |
| 5 build nativ pe telefon real | BLOCKED (owner/telefon) | Expo Go merge pe :8082; build EAS = cont Expo + timp de build, cere OK |
| 6 pregătire release | NEÎNCEPUT | store/semnare = owner |

## Interconectare
- I1: rândurile CLIENT în `MATRICE-INTERACTIUNE.md` (`8ebd745`).
- I2 (CLIENT consumator): sim 103 (Epuizat RESTAURANT → place_order), sim 104 (push-uri la client pe accept/refuz/ridicat/livrat). Ambele verzi, ambele roșii la mutație.
- I3: scenariul 4 = sim 105 (anularea clientului în fiecare stare). Restul scenariilor: vezi matricea.
- I4: tot pe DB local, rolled back (sim) sau date de test locale (smoke). Nimic pe live.
- I5: toate sesiunile comit direct pe `main` (nu există branch-uri de sector) — poarta de merge = `npm run test:rpc` + `verify` + testele sectorului înainte de fiecare commit.

## Doar declarat / de dovedit
- Comandă plasată de pe iPhone (Expo Go) cu pin pe hartă — aștept userul la telefon.
- Verificatorul separat pentru gate 1–2 rula la scriere.

## Deschis (ordine)
- Pin pe evenimentul de catering (cerere RESTAURANT, rândul 14) — `catering_details` n-are lat/lng: schimbare de contract.
- ETA din busy mode / `extend_prep_time` în tracking.
- C2–C6 din PLAN-CONSTRUCTIE.
- `DeliveryMap` (comun) cu tile-uri CARTO moarte — predare trimisă.
- Raza implicită 10 km = PROVIZORIE, ratificare owner.
