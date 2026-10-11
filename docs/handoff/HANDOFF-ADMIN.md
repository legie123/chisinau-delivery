# HANDOFF — ADMIN — panoul platformei (ops, bani, risc, onboarding)

> Generat 2026-10-11 din sesiunea CLIENT (paritate Bolt Food, chisinau-delivery). Repo: `~/code/chisinau-delivery`, branch `main`, ultimul commit la scriere: vezi `git log -1`. Lucrezi DOAR pe suprafața ta; restul e al celorlalte 3 sesiuni.

## 0. Citește întâi (în ordinea asta)
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
- `dispatch_errors` (a18b8aa): erorile de dispecerizare se înregistrează (un rând/comandă/cod, cu contor); citire doar `platform_admin` + paritate viewer (sim 88).
- `admin_stuck_orders` (aee4ca2, 325a36f): „Fără ofertă activă” după 3 min, eroare de dispecerizare imediat (doar dacă e din ultimele 10 min și fără ofertă vie), comenzi programate cu fereastra închisă excluse, „între valuri” nu mai pâlpâie (sim 89, 92). Acum le deții tu.
- `scripts/check-push-wiring.sql` (3a0c4ff): poarta de deploy pentru push (pică local, by design).

## 6. Cum pornești
- `bash scripts/apps/dev.sh master` → http://localhost:3004. Intrare: `/master` (în dev fără parolă) sau POST `/enter/...`. Ops: `src/app/(admin)/platform/page.tsx`, cozi: `platform/queues`.
- „Vezi ca” (view-as) cere `SUPABASE_JWT_SECRET` = secretul rotit; `scripts/apps/dev.sh` îl dă deja din `supabase-status.sh` (cacf56f a reparat același lucru pe :3007).

## 7. Priorități (din plan-paritate + criticul de completitudine)
1. **Payouts care chiar plătesc** (W3): `generate_payouts_internal(week)` apelabil din cron fără JWT (azi `admin_generate_payouts` cere `has_role('platform_admin')`), idempotent; **granițele săptămânii în Europe/Chisinau cu DST** (sim cu o comandă duminică 23:30 ora locală); export CSV pentru bancă (format de confirmat de user).
2. **Suport minim pentru pilot** (critic #1–#2): jurnal de reclamații pe comandă, RPC de ajustare/rambursare parțială cu sim, cut-off configurabil pentru comenzile fără curier (azi auto-anulare abia după 6 h) + push către client.
3. Alerte cu mecanism (W5): bucket `pending_restaurant` neacceptat în N min, rânduri noi în `dispatch_errors`, outbox blocat → webhook (canalul îl alege userul).
4. Onboarding curier → cum primește curierul aprobat login-ul în aplicație (critic #7; azi doar `invitePartner` are set-password).
5. Înainte de orice lansare: șterge ușile de dev (`src/app/enter/[role]`, `/master`, autologin din `src/proxy.ts`) + review de securitate RLS.

## 8. Lista ta de goluri față de Bolt Food (gap-map, doar `no`/`partial`, ordonate must→could)
Re-verifică fiecare rând în cod înainte să-l construiești — gap-map-ul e o fotografie din 2026-10-11.

| prio | stare | funcție (paritate Bolt) | dovadă din cod (gap-map) |
|---|---|---|---|
| must | no | Order types delivery / pickup / own_delivery | orders.order_type CHECK only ('standard','catering') (20260708000400_orders_and_catering.sql:20). grep pickup/takeaway/self_pickup/own_delivery in … |
| must | no | Invoicing with VAT | grep -iE 'vat/tva/invoice/factur' over supabase/migrations, packages, mobile/*/src: only unrelated hits (order_number CHD-YYYY, a comment in 202608… |
| must | no | Support case system (one open case per order) | grep -iE 'support_case/support_ticket/ticket' over supabase/migrations and packages: empty (only dispatch/errors text hits). No case table, no cust… |
| must | no | City / zone and service-area management | No zones/service_area table (full table list from migrations has none; grep delivery_radius/service_area empty). Only a PostGIS nearby_restaurants(… |
| must | partial | Fee engine (delivery by geo / small order / service) | Customer fee is a flat per-restaurant column delivery_fee_mdl plus min_order_amount_mdl (20260708000200_restaurants_and_menu.sql:18; place_order co… |
| must | partial | Payments: card auth + capture after delivery | payment_intents provider default 'mock' ('maib'/'paynet' later) and payment_status pending_capture (20260718000000_platform_foundation.sql:44-81); … |
| must | partial | Courier and venue payout engine (weekly) | payouts + payout_orders tables, admin_generate_payouts(p_start,p_end) for restaurants and couriers, admin_mark_payout_paid, immutability guards (20… |
| must | partial | Push and SMS notification service | Push is real: notification_outbox + pg_cron drain every 10s (20260718000200_notification_outbox.sql), customer push (20260726000200_customer_push_o… |
| must | partial | Authentication (phone + OTP) | Auth works but is email+password with email-OTP password recovery: mobile/client/src/screens/LoginScreen.tsx (signIn, signUp, verifyOtp at :38,:75)… |
| should | no | Wallet ledger (Bolt Balance) | grep -iE 'wallet/customer_balance/store_credit' over supabase/migrations, src, packages, mobile/*/src returned empty. Only courier_cash_movements (… |
| should | no | Localization and translations of menus | menu_items/restaurants have single name/description text columns (20260708000200_restaurants_and_menu.sql:6,8,74,90); grep name_en/name_ru/translat… |
| should | partial | Ratings aggregation with dispute exclusion | ratings table, submit_rating RPC, denormalized rating_avg/rating_count on restaurants and couriers (20260717001500_ratings.sql), admin low-ratings … |
| should | partial | Account and data deletion / export | Backend exists: erase_customer_pii(uuid) callable by the customer or admin (20260726000500_gdpr_retention.sql:37-60) plus daily purge-expired-pii c… |
| should | partial | Fraud and abuse controls | Courier-side only: fraud_flags table (gps_teleport, cash mismatch kinds) written by triggers/reconcile (20260717001700_ws10_gps_plausibility.sql:90… |

## 9. Prompt de pornire (lipește-l în terminalul tău)
```
Citește integral ~/code/chisinau-delivery/docs/handoff/HANDOFF-ADMIN.md și lucrează pe suprafața ADMIN după regulile de acolo. /bucla
```
