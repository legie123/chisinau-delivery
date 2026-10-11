# HANDOFF — CURIER — aplicația curierului (mobile/driver) + web (courier)

> Generat 2026-10-11 din sesiunea CLIENT (paritate Bolt Food, chisinau-delivery). Repo: `~/code/chisinau-delivery`, branch `main`, ultimul commit la scriere: vezi `git log -1`. Lucrezi DOAR pe suprafața ta; restul e al celorlalte 3 sesiuni.

## 0. Citește întâi (în ordinea asta)
0. **`docs/handoff/PLAN-CONSTRUCTIE.md`** — etapele sectorului tău și punctele de sincronizare cu celelalte terminale.
1. `CLAUDE.md` din repo (regulile dure 1–9, „If you touch X”) + `AGENTS.md` (Next 16 ≠ ce știi).
2. `replica/plan-paritate.md` (planul W1–W7, decis prin dezbatere + red-team) și `replica/gap-map.csv` (157 funcții Bolt vs cod, cu dovezi).
3. `.bucla/progress.md` secțiunea „2026-10-11 — Paritate Bolt Food”.
4. Acest fișier, tot. Apoi `git log --oneline -15`.

## 1. Patru sesiuni lucrează ÎN PARALEL pe același repo și aceeași bază locală
| sesiune | suprafață | deține (scrie) | server local |
|---|---|---|---|
| **CLIENT** (sesiunea de origine) | `mobile/client` (Expo Go) + web `(customer)` | `mobile/client/**`, `src/app/(customer)/**`, `src/components/customer/**` | Metro **:8082**, web complet **:3007** (`scripts/dev-local.sh`), tunelul mobil |
| **CURIER** | `mobile/driver` + web `(courier)` | `mobile/driver/**`, `src/app/(courier)/**`, `src/components/courier/**`, `src/hooks/useBroadcastCourierLocation.ts` | Metro **:8083** |
| **RESTAURANT** | panoul partenerului + tableta de bucătărie | `src/app/(admin)/restaurant/**`, `apps/restaurant/**`, `src/lib/kitchen/**`, componentele partenerului din `src/components/admin/` (OrderQueue*, Menu*, ItemModifiersManager, AddMenuItemForm, AcceptingOrdersToggle, RestaurantLocationControl, CateringQuoteCard, VenueBookingControl, RestaurantCancelControl, ReadyTargetBadge, RestaurantWaitKpiChips) | **:3003** (`bash scripts/apps/dev.sh restaurant`) |
| **ADMIN** | panoul platformei (ops, bani, risc) | `src/app/(admin)/platform/**`, `apps/master/**`, `src/lib/ai/**`, restul componentelor din `src/components/admin/` | **:3004** (`bash scripts/apps/dev.sh master`) |

**Funcții SQL — cine are voie să le recreeze** (regula 9: corpul LIVE, o deltă):
- CLIENT: `place_order`, `set_order_tip`, `submit_rating`, RPC-urile de discovery/căutare, adrese.
- CURIER: `dispatch_order`, `expire_dispatch_offers`, `assign_courier`, `advance_delivery_status`, `courier_*`, `attach_delivery_proof`, `record_cash_offload`, `nearby_available_couriers`.
- RESTAURANT: `accept_order`, `reject_order`, `mark_ready_for_pickup`, `restaurant_cancel_order`, tabelele de meniu, catering quote, venue booking.
- ADMIN: tot ce e `admin_*` (inclusiv view-ul `admin_stuck_orders` și tabelul `dispatch_errors`), payouts, fraud, onboarding review, `purge_expired_pii`, `pricing_config`.
- Ai nevoie de o schimbare într-o funcție/fișier al altei sesiuni? **Nu o faci.** Adaugi o linie în `docs/handoff/CROSS-REQUESTS.md` (cine cere, ce, de ce, dovadă) și îi spui userului. Proprietarul o preia.

## 2. Reguli de coexistență (le-am plătit deja azi)
- **Commit doar pe căi explicite**: `git add <fișierele tale>`. NICIODATĂ `git add -A` / `git add .` / `git stash` / `git checkout -- <al altuia>`. Commit e pre-autorizat în repo; **push și deploy NU** (cer OK explicit de la user).
- Două fișiere ale userului sunt necomise de zile: `docs/LOOP-NOAPTE.md`, `src/app/(customer)/orders/page.tsx` — nu le atinge, nu le comite.
- **Migrații**: sufixul din nume pe intervale, ca să nu se ciocnească: CLIENT `0001NN`, CURIER `0002NN`, RESTAURANT `0003NN`, ADMIN `0004NN` (ex. `20261012000201_offer_preview.sql`). **Sim-uri** `tests/rpc/`: CLIENT 100–149, CURIER 150–199, RESTAURANT 200–249, ADMIN 250–299.
- Recreezi o funcție: ia `pg_get_functiondef` **chiar înainte să aplici** (altă sesiune poate tocmai s-o fi schimbat). Aplici cu `env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin" supabase migration up --local` (înregistrează în ledger). Intrare în `docs/migrations.md` (sus, cea mai nouă prima) + sim care PICĂ fără fix.
- **INTERZIS fără să-l întrebi pe user**: `supabase db reset`, `supabase stop`, repornire Colima/Docker, `kill` pe procese pe care nu le-ai pornit tu. Toate patru sesiunile depind de același stack.
- **Cheile locale**: mereu `bash scripts/supabase-status.sh`, niciodată `supabase status` simplu (secretul JWT e rotit din 79dc0ee; status-ul simplu dă chei care nu merg).
- Înainte de commit: `npm run verify` (+ `npm run test:rpc` dacă ai atins DB) și `bash scripts/facts.sh`. Drift în counted facts din cauza fișierelor necomise ale ALTEI sesiuni e normal; se aliniază când comite ea.
- `npm run test:e2e` COMITE date (comenzi `E2E-*`) și folosește toate rolurile → rulează-l doar după ce i-ai spus userului.
- Subagenții tăi împart cu tine browserul Playwright și baza: nu verifica în browser cât un subagent navighează, nu rula sim-uri care scriu fără `BEGIN/ROLLBACK`.

## 3. Starea infrastructurii (2026-10-11 seara, verificată)
- Supabase local: API `127.0.0.1:54421`, DB `54422`, totul pe loopback (`scripts/check-local-exposure.sh`). Pornire DOAR cu `bash scripts/supabase-up.sh`.
- Colima (VM Docker, 6 GB) a căzut de 2 ori azi când a pornit containerul OSRM; **`osrm-chisinau` e oprit, restart policy `no`** → rutele merg pe fallback-ul public din `src/lib/routing/route.ts`. Nu-l porni.
- **Portul 8081 e ocupat** de un forward Colima (ssh mux) — Metro pe 8081 crapă când se conectează telefonul. Folosește 8082 (client) / 8083 (curier).
- `:3000` (launchd `com.chisinau-delivery.server`) are cheile VECHI din `.env.local` → login eșuează acolo. Nu-l folosi; userul decide când actualizează `.env.local`.
- Tunel mobil Cloudflare (`mobile/.tunnel.env`, TTL 90 min, doar data plane prin allowlist) — **îl deține sesiunea CLIENT**. Dacă expiră, spune-i userului; repornire: `bash scripts/mobile/tunnel.sh 90`, apoi TOATE Metro-urile trebuie repornite (URL-ul se schimbă).
- Contul Expo: Mac-ul e logat ca **alliancedragons123** (`npx expo whoami`). Nu da logout. `mobile/client` e legat la proiectul EAS `@alliancedragons123/dragons-delivery-client` (bb870f1).
- Hook-ul skill-scout NU mai instalează automat (auto_install.enabled=false); nu instala skill-uri/pluginuri fără OK.
- Garda de secrete (`~/.claude/helpers/arbitrate.mjs`) rescrie tăcut în `REDACTAT` liniile care arată a credential — după orice Write/Edit cu `secret/token/password` în text: `grep -n REDACTAT <fișier>`.

## 4. Cum lucrezi (protocolul buclei din repo)
END-STATE verificabil + SCOPE + STOP-RULE → iterație: test care pică întâi → cea mai mică schimbare → verify/test:rpc → **dovadă din realitate** (sim rolled-back, browser, telefon) → commit atomic → `.bucla/progress.md`. După o rundă importantă: un agent separat care încearcă să INFIRME (azi a găsit 7 defecte în 4 commit-uri „verzi”). La final de task: RECAP în formatul cerut de `~/.claude/CLAUDE.md`.

## 5. Ce s-a făcut azi pe suprafața ta (nu reface)
- `768c26d`, `8b1ba17` — pini reali (null = fără marker), ușa (scară/etaj/interfon), telefoane, „Spre restaurant/Spre client” + „Sună”, recitire cu retry după atribuire, fără rating 4.9/badge 3 fals.
- `447d389` — heartbeat de poziție la 45 s cât curierul e online și liber (foreground).
- Dispecerizare: `a18b8aa` (erori → `dispatch_errors`), `747340a` + `325a36f` (poziție vie 2 min > recentă 10 min > fără; rotație corectă; distanța necunoscută = null). Sim-uri 88–91.

## 6. Primul obstacol: aplicația NU se poate deschide încă pe telefon
- `mobile/driver` e pe Expo **~54**; Expo Go din App Store rulează doar SDK **57**. Pasul 1 = upgrade la 57 (ca `mobile/client`: expo ~57.0.27, RN 0.86.3), cu skill-ul `expo:expo-upgrade`, **commit separat**, apoi `npx tsc --noEmit` + `npx vitest run` în `mobile/driver`.
- Expo Go merge doar în foreground (GPS-ul de fundal din `src/lib/backgroundLocation.ts` NU rulează în Expo Go). Pentru test real: dev client. Mac-ul e deja logat în Expo → `cd mobile/driver && npx eas-cli@latest init --non-interactive --force` (leagă proiectul) apoi `npx eas-cli@latest build --profile development --platform android` (APK, ~15 min cloud; cere OK userului înainte — consumă minute de build). iPhone nativ cere Apple Developer (99 USD/an) — decizia userului.
- Metro pentru driver: `--port 8083` (8081 e ocupat). Env din `mobile/.tunnel.env` (vezi `scripts/mobile/dev.sh`; adaugă-i `--port` dacă îl folosești).

## 7. Priorități (din plan-paritate, în ordine)
1. Upgrade Expo 54→57 (W1, rămas) + rulare pe telefon.
2. `offer_preview(offer_id)` — sectorul de livrare + km totali + km până la restaurant, DOAR pentru curierul cu oferta vie (W2).
3. Gaura de plată a curierului: tariful cade pe 6.0 km pentru adrese fără pin (`20260731000200`:81, :148) — marchează/plătește corect (W2; bani → sim rolled-back obligatoriu).
4. Foto la livrare în aplicație (`attach_delivery_proof` există în shared-api, nefolosit pe mobil), depunere cash (`record_cash_offload`), rândul mort „Ajutor & Suport”, rândurile moarte din Profil.
5. KYC/înscriere în aplicație; IBAN în profil (W3); heartbeat și pe web-ul curierului (azi curierii web stau mereu în nivelul „fără poziție” la dispecerizare).

## 8. Lista ta de goluri față de Bolt Food (gap-map, doar `no`/`partial`, ordonate must→could)
Re-verifică fiecare rând în cod înainte să-l construiești — gap-map-ul e o fotografie din 2026-10-11.

| prio | stare | funcție (paritate Bolt) | dovadă din cod (gap-map) |
|---|---|---|---|
| must | partial | Courier registration (name city phone) | Web only: src/app/(customer)/devino-partener/CourierApplicationForm.tsx (full_name, phone, email, vehicle_type -> submitApplication -> onboarding_a… |
| must | partial | Courier document upload and verification | Web only: src/components/onboarding/DocumentUpload.tsx -> private bucket kyc-documents + add_kyc_document RPC; the form asks only for id_card (Cour… |
| must | partial | Vehicle type selection | Chosen at web registration (CourierApplicationForm.tsx select: bike/e_bike/scooter/car; no motorbike). couriers.vehicle_type check in supabase/migr… |
| must | partial | Order offer with pickup pin ETA and earnings | mobile/driver/src/components/OfferCard.tsx shows restaurant, net earnings (offerNetLabel, api.ts) and '~X km până la restaurant' (dispatch_offers.d… |
| must | partial | Navigation to venue and customer | Web: src/app/(courier)/deliveries/[deliveryId]/page.tsx mapsUrl 'Navighează cu Google Maps' plus CourierRouteMap with road route and ETA. Mobile: A… |
| must | partial | Delivery instructions view | Mobile: api.ts mapOrders selects only street_address, building, apartment from addresses, so no entrance/floor note, no contact phone, no call-cust… |
| must | partial | Handover completion (cash collect / checkboxes / rate / Delivered) | Mobile: swipe, then Alert 'Ai încasat plata (cash/POS)?' (ActiveDeliveryScreen.tsx:~106), delivered, earnings floor shown. No handover checkboxes, … |
| must | partial | Weekly payout Mon-Sun | The payouts list with status pending/paid/failed is shown in EarningsScreen.tsx (api.ts fetchEarningsSummary reads payouts); week = Mon-Sun via cur… |
| should | no | Running late / cannot find venue / cannot find customer flows | grep running_late/cannot find/nu pot gasi/unreachable in mobile/driver/src, src/components/courier and supabase/migrations returned no courier flow… |
| should | no | Age verification block | grep age_verif/id_check/requires_id/alcohol in src, mobile/driver, supabase/migrations, packages returned empty. |
| should | no | Customer unreachable 5-minute rule | No unreachable/no-show RPC or UI: grep customer_unreachable/unreachable in src/components/courier, mobile/driver and migrations found no courier fl… |
| should | no | Report issue / hazard button | grep hazard/report_issue/incident/issue_report in mobile/driver, src/components/courier, supabase/migrations, packages returned empty. The Profile … |
| should | no | Delivery preferences (cash / ID-check orders) | grep accept_cash/cash_pref/prefers_cash/id_check in src, mobile, migrations returned empty. There is no preference screen, and the Profile 'Setări'… |
| should | no | Bank details and tax info | grep iban/bank_account/IBAN/tax_id/idno in src, mobile/driver, packages and migrations returned empty. Profile 'Cont bancar' is a dead row (Profile… |
| should | partial | Offer radius by vehicle | Vehicle only enters dispatch scoring as an assumed speed (bike 12, e_bike 18, scooter 25, car 22 km/h) in dispatch_order, supabase/migrations/20260… |
| should | partial | Unassign or decline with limit | Decline works: decline_dispatch_offer (migration 20260717001600:201) and the OfferCard Decline button. A decline excludes the order for that courie… |
| should | partial | Tips shown after delivery (100% to courier) | Mobile EarningsScreen.tsx:~111 states 'bacșișul e 100% al tău' and the offer excludes the tip, but there is no per-delivery tip amount: OrdersHisto… |
| should | partial | Negative balance payment | Cash float exists: EarningsScreen.tsx:~118 shows 'Numerar la tine X / cap MDL' plus cash.offload_channel_text from getCourierCashStatus (shared-api… |
| could | no | Delivery kit instructions | grep kit/instruct* in mobile/driver/src and src/app/(courier) found no onboarding or kit content. Not present. |
| could | no | Multi-drop batching with trip planner | courier_has_capacity() blocks a new offer while the courier has any order in courier_assigned/picked_up/en_route (supabase/migrations/2026072700190… |
| could | no | Early cashout | grep early_cashout/cashout/instant_payout in src, mobile, migrations, packages returned empty. |
| could | no | Waiting-time compensation | The tariff has wait_per_min_mdl/wait_grace_minutes, but the fee computation hardcodes `v_wait_minutes := 0` ('observe-only ruling: fără compensare … |
| could | partial | Waiting-for-orders map with peak-area hints | MapScreen.tsx has the dark map, own GPS marker and an 'Așteptăm comenzi...' card. No heatmap or peak-area hints (grep surge/peak/heat/zone in mobil… |
| could | partial | Peak / zonal multipliers and surge | Only a flat, admin-set weather surcharge per delivery in courier_tariff_config (supabase/migrations/20260731000200_weather_surcharge.sql). No zonal… |

## 9. Prompt de pornire (lipește-l în terminalul tău)
```
Citește integral ~/code/chisinau-delivery/docs/handoff/HANDOFF-CURIER.md și lucrează pe suprafața CURIER după regulile de acolo. /bucla
```

## 10. Stare sector CURIER (actualizată de sesiunea CURIER, 2026-10-11 seara)
Branch: `main` comun (nu un branch de sector: cele 4 sesiuni împart un singur working tree, iar un `checkout` le-ar muta pe toate). Commit-urile se fac din index temporar (`GIT_INDEX_FILE`), fișierele comune ca HEAD + rândurile proprii.

| gate | stare | dovadă / blocaj |
|---|---|---|
| 1 verificare adversarială | în lucru | verif-curier re-rulează pe `83ee8a7` (prima rundă: NEVALIDAT, 5 defecte reparate în `80b9efa`) |
| 2 defecte rămase | DONE | `83ee8a7`: flag pe 3 stări + backfill (local 28 true / 61 necunoscut, suma 2060,33 neschimbată; sim 152 pe 5 mutații; rollback executat); lockfile reconstruit, `scripts/lock-justify.mjs`: 333 mutate / 333 justificate SDK / 0 derivă (control: 13 derivă pe lock-ul vechi) |
| 3 matrice | DONE | tabelul de mai jos |
| 4 construcție | în lucru | ordinea de mai jos |
| 5 build nativ | BLOCKED (owner) | EAS dev client = minute de build + cod urcat pe Expo; telefon Android; backend accesibil de pe telefon (tunel CLIENT sau staging) |
| 6 release | BLOCKED parțial | crash reporting = SDK nou (aprobare), declarația Play pentru locația în fundal, semnare/store = owner |

### Matrice de paritate — aplicația curierului (verificat în cod, 2026-10-11)
| Flux | Stare | Fișierul care dovedește | Blochează o comandă reală? |
|---|---|---|---|
| Onboarding + documente | PARTIAL | web: `src/app/(customer)/devino-partener/CourierApplicationForm.tsx`; aprobare `src/app/(admin)/platform/onboarding/actions.ts`; contul vine prin `inviteCourier` (`src/app/(admin)/platform/couriers/actions.ts:26`, cere service role + SMTP); în app rândurile moarte din Profil (Documente, Vehicul, Program, Setări, Editează) au fost scoase până au un backend; „Ajutor & Suport” apare doar cu `EXPO_PUBLIC_SUPPORT_PHONE` setat (numărul = owner) | DA pe hosted (fără SMTP nu primește cont; ADMIN/owner); local nu (conturi seed) |
| Online / offline | EXISTA | `MapScreen.tsx:174` + `ProfileScreen.tsx:144` → `set_courier_online_status` | nu |
| Card ofertă cu timeout | EXISTA | `components/OfferCard.tsx` (30 s, `onExpire`) + `offer_preview` (sector, km total); sweeper-ul expiră oferta în DB | nu |
| Accept / refuz | EXISTA | `lib/api.ts` `acceptDispatchOffer` / `declineDispatchOffer` (RPC) | nu |
| Navigație la restaurant | EXISTA | `ActiveDeliveryScreen.tsx:176-179` `navUrl(pickup)` + `tel:` | nu |
| Confirmare pickup | EXISTA | „Am ajuns la restaurant” (`ActiveDeliveryScreen.tsx:288`, `courier_arrived_at_restaurant`) + swipe → `advanceOrEnqueue(en_route)`; numărul comenzii pe card (`api.ts:285`) | nu |
| Navigație la client | EXISTA | `navUrl(dropoff)`, fără pin → adresa text (`lib/orderView.ts`); `tel:` client | nu |
| Confirmare livrare | PARTIAL (foto: cod + teste, nedovedit pe device) | swipe + „Ai încasat plata?” (`ActiveDeliveryScreen.tsx`); foto la livrare: „Fă o poză la livrare” → `expo-image-picker` (doar cameră) → bucket privat `delivery-proof/<order>/…` → `attach_delivery_proof` (sim 33); lipsește încă calea „nu pot livra” | nu (foto = semnal soft) |
| Cash | PARTIAL | `payment_confirmed` la livrare; plafonul în `EarningsScreen.tsx`; depunerea o înregistrează doar adminul (`couriers/actions.ts:68`); „Nu încă” nu are continuare (client care nu plătește) | nu (ops are calea) |
| Câștiguri + istoric | EXISTA (nedovedit pe device) | `EarningsScreen.tsx`, `OrdersHistoryScreen.tsx`; IBAN-ul pentru plata săptămânală se setează acum din Profil (`components/PayoutAccountForm.tsx` → `set_payout_account`, validare identică cu serverul: 1006 vectori, 0 dezacorduri); istoricul arată bacșișul pe livrare și când tariful a folosit distanța estimată | nu (dar fără IBAN nu se poate plăti săptămâna) |
| Push | PARTIAL | `lib/push.ts:43-51` cere `projectId` EAS — absent (`EAS_PROJECT_ID` doar din env) → zero token-uri; drain-ul are URL local implicit (`20260718000200:128`) | DA: cu app-ul în fundal curierul nu primește oferta (gate 5 + FCM/owner) |
| Locație în fundal | PARTIAL | `lib/backgroundLocation.ts` (doar în livrare, 14 teste); nedovedit pe device după SDK 57 (Expo Go nu rulează task-uri de fundal) | nu (heartbeat foreground + broadcast) |
| Raportare problemă | EXISTA (cod + sim; nedovedit pe device) | `ActiveDeliveryScreen.tsx` „Raportează o problemă” → `lib/issues.ts` (tipuri pe etapă) → `courier_report_issue` (`20261012000205`, sim 153); adminul nu le vede încă într-o suprafață (cerere ADMIN) | indirect, rămâne cât adminul nu le afișează |
| Rețea slabă | EXISTA | `lib/offlineQueue.ts`, `hooks/useOfflineSync.ts`, `lib/offerPoll.ts`, `tests/lapsedSession.test.ts` | nu |

**Ordinea construcției (gate 4):** cele două DA depind de owner (SMTP/onboarding hosted, push/EAS/FCM). Din ce nu e blocat: (1) raportare problemă (LIPSA), (2) foto la livrare — FĂCUT în cod (dependența nativă e deja în package.json, deci intră în primul build dev client), apoi cash „nu plătește”, bacșiș pe livrare, rândurile moarte din Profil.
