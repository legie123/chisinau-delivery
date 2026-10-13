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

## Verificatori 2026-10-12 (rezultate)
- CLIENT gate 2 NEVALIDAT → (1) retry idempotent ocolea totalul: REPARAT 20261012000104, sim 106. (2) catering: `confirm_catering_quote` nu primește suma afișată, `place_order` catering ignoră `p_expected_total` — DE FĂCUT (confirm = funcție RESTAURANT → predare). (3) `test:price` nu acoperă randarea CartScreen — limită declarată. (4) web fără total: REPARAT în 70d9288. (5) `check:config` nelegat de nicio poartă — de legat.
- ADMIN plăți (scrise de această sesiune) NEVALIDAT: (1) CSV plătește în plus când există clawback negativ pending (105,50 MDL în probă); (2) cron-ul plătește doar săptămâna trecută, nu recuperează comenzi marcate plătite târziu / rulări ratate; (3) orice staff schimbă IBAN-ul fără urmă; (4) erori ignorate + 414 la >200 beneficiari în pendingBankRows. Scripturi: scratchpad/rt/. NEREPARATE — prioritate maximă pentru cine preia plățile.

## Runda 2026-10-12 (după)
- Defectele red-team ale plăților (scrise de această sesiune) REPARATE: 7fac27b (cron recuperează, sim 256), 50c9a03 (sold net + export pe loturi, sim 257), c9e299c (istoric IBAN + avertisment 7 zile, sim 258). Rămas: rol pe staff (predare RESTAURANT).
- 3a9ff78 refuzurile noi ajung la client ca text (mutație → 5/5 roșu); `npm run verify` în mobile/client = tsc + vitest + check:config.
- ad83f4b sim 107 încrucișat: busy mode și `extend_prep_time` mută ETA-ul văzut de client (rândul din matrice corectat: era deja consumat).
- 7ee2104 numărul de suport fals scos; vine din `EXPO_PUBLIC_SUPPORT_PHONE` / `NEXT_PUBLIC_SUPPORT_PHONE` — **ownerul dă numărul real**.
- C2 notă per produs: e0f888d (place_order, sim 108) + 37ed580 (coș mobil; smoke real: nota ajunge în order_items.notes).
- Tunel + Metro :8082 repornite pentru gate 5 (Expo Go pe iPhone, exp://192.168.1.34:8082).

## Red-team runda 2 (2026-10-12) — toate defectele reparate
- HIGH decontarea legată de suma din pagină, nu de fișierul exportat (+80 MDL): `62982be` — loturi de export înghețate (`payout_exports`), decontare pe linie de lot, clawback-ul de după export se compensează la exportul următor; IBAN schimbat de la ultima plată cere confirmare. Sim 259.
- MEDIUM retry idempotent compara doar totalul (adresă/plată/produs/catering ignorate): `069f98b` — `orders.request_fingerprint`. Sim 111.
- MEDIUM recuperarea plăților fără limită (ar fi plătit tot istoricul în prima zi): `b0dd8dc` — `payouts_catchup_from`, implicit începutul registrului. Sim 260.
- LOW schimbarea doar a titularului IBAN: `b0dd8dc`.
- Rămas LOW: aceeași cheie după anulare întoarce comanda anulată (clientul rotește cheia după succes, deci nu apare în fluxul normal).
- Alte livrări: `8013a21`+`460ffb5` ștergerea contului (App Store 5.1.1(v)); `2af3224` manifest de confidențialitate iOS; `b0f315a`+`8109eee` banner „toți curierii sunt ocupați”; `92bc424` notă per produs și pe web.

## GATE 3 — Matricea de paritate CLIENT (verificată pe cod, agent separat read-only, 2026-10-12)
| Flux | Stare | Dovadă | Blochează comanda? |
|---|---|---|---|
| 1 Autentificare | PARȚIAL | email+parolă + reset cu cod (`LoginScreen.tsx:83-113`); fără telefon/OTP | nu (OTP/SMS = owner, cost) |
| 2 Adresă + pin pe hartă | EXISTĂ | `PinPicker.tsx`, obligatoriu `checkout.ts:202`, server `…000103` | nu |
| 3 Descoperire (zonă, deschis, ETA, taxă) | PARȚIAL | zonă doar pe prima adresă cu pin; „ETA” = interval de pregătire | nu |
| 4 Căutare + categorii | EXISTĂ | `SearchScreen.tsx:61`, `browse.ts` | nu |
| 5 Meniu cu modificatori + Epuizat | EXISTĂ | `ModifierSheet.tsx`, `RestaurantScreen.tsx` | nu |
| 6 Coș + notă per produs | EXISTĂ | `CartScreen.tsx:330`; prin API real ajunge în `order_items.notes` (37ed580) | nu |
| 7 Checkout cu defalcare | EXISTĂ | `checkoutTotals`, `p_expected_total` (…101/104/108) | nu |
| 8 Plată | PARȚIAL | cash + card la POS; online = owner (maib) | nu |
| 9 Coduri promo | LIPSĂ | grep = 0 | nu (reguli comerciale = owner) |
| 10 Tracking + cronologie | PARȚIAL | live + timeline; ETA linie dreaptă | nu |
| 11 Contact curier / suport | PARȚIAL | apel curier; suport fără număr până îl dă ownerul | nu |
| 12 Anulare client | PARȚIAL | doar `pending_restaurant`; după acceptare nicio acțiune în app | risc |
| 13 Istoric + reorder | EXISTĂ | `OrdersScreen.tsx`, `reorder.ts` | nu |
| 14 Evaluare | EXISTĂ | `OrderTrackingScreen.tsx:233-250` | nu |
| 15 Push | EXISTĂ | `push.ts`, outbox + drain (livrarea pe telefon nedovedită) | nu |
| 16a Gol: închis | PARȚIAL | banner + „se deschide…”; nu poți programa la un local închis | nu |
| 16b Gol: în afara zonei | PARȚIAL | marcat pe Home; meniul/coșul nu avertizează | risc (refuz târziu) |
| 16c Gol: fără curieri | PARȚIAL | banner doar pe Home | risc |
Ordinea de construcție: 12 (problemă raportată din app după acceptare) → 16c → 16b → 16a.

## Red-team runda 3 (2026-10-13) — 7 defecte reparate: migrația `20261012000111`, sim 113
- HIGH `banned_until='infinity'` din `delete_my_account` rupea GoTrue (500 pe lista de utilizatori): acum `2999-12-31`, conturile deja șterse reparate; verificat `GET /auth/v1/admin/users` = 200.
- MED date personale rămase după ștergere (evaluări, reclamații proprii, contacte catering/rezervări, onboarding, notificări, token-uri, jurnal auth): `scrub_deleted_customer` (intern); rezervarea viitoare blochează ștergerea.
- MED clientul citea notele/rezoluțiile ops din `order_complaints`: policy șters; aplicația arată doar starea (`my_order_complaint_status`). Sim 112.5 / 252.4 actualizate.
- MED injecție în webhook-ul ops: alerta fără textul clientului; `scan_ops_alerts` neutralizează `< > @`, mențiuni dezactivate (probat pe coada pg_net).
- LOW+ JWT emis înainte de ștergere: `place_order`, adrese, profil refuză „Contul a fost șters.”
- LOW `customer_report_problem`: comenzile anulate/respinse neacceptate refuzate; max 3 pe comandă. LOW amprenta cererii: opțiunile sortate.
- Gate 2 catering ÎNCHIS: RESTAURANT a livrat `confirm_catering_quote(p_order_id, p_expected_total)` (b76348f); aplicațiile trimit suma afișată (mobil `OrderTrackingScreen`, web `CateringTracking`), sim 114 încrucișat (3500 afișat / 9000 re-cotat → refuz, nimic scris).
