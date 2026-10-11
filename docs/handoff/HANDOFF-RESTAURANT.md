# HANDOFF — RESTAURANT — panoul partenerului + tableta de bucătărie

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
- `7daa974` — bipul de comandă nouă sună cu adevărat: un singur AudioContext deblocat de un tap („Activează sunetul pentru comenzi noi”, reapare dacă sunetul se blochează) + Screen Wake Lock pe pagina de comenzi. Dovedit în browser (6 tonuri pe context „running”). `src/lib/kitchen/alertAudio.ts` + `tests/unit/alertAudio.test.ts`.

## 6. Cum pornești
- `bash scripts/apps/dev.sh restaurant` → http://localhost:3003 (shell subțire peste `src/`). Intrare de test: POST `/enter/restaurant` (cont `partener@test.md`), sau `:3007/enter/restaurant` dacă rulează serverul complet al sesiunii CLIENT.
- Coada: `src/app/(admin)/restaurant/orders/page.tsx` + `src/components/admin/OrderQueueLive.tsx`.

## 7. Priorități (din plan-paritate, în ordine)
1. Tableta (W2, rest): refuz cu motiv, **busy mode** (+15/30/45 min care alimentează `estimated_ready_at` și ETA-ul clientului), istoric comenzi, bon tipărit, cardul curierului după atribuire (prenume + hartă; telefonul printr-un RPC nou `restaurant_courier_contact` — decizia userului dacă restaurantul vede telefonul).
2. **„Epuizat” rapid**: azi `menu_items.is_available=false` înseamnă și „ascuns” — RLS îl ascunde publicului. Corect: coloană separată (ex. `sold_out_until`) + gardă în `place_order`. Migrația și UI-ul partenerului sunt ale tale; **`place_order` e al sesiunii CLIENT** și randarea „Epuizat” pe client tot a ei → cere prin `CROSS-REQUESTS.md`.
3. Import de meniu în masă (azi doar manual; critic de completitudine #4) + confirmarea drepturilor pe poze.
4. Câștiguri: export CSV săptămânal, IBAN restaurant cu validare MD (W3, cu ADMIN pentru payouts).
5. Checklist de instalare a tabletei (PWA pe ecranul principal, mod kiosk, încărcător, sunet).

## 8. Lista ta de goluri față de Bolt Food (gap-map, doar `no`/`partial`, ordonate must→could)
Re-verifică fiecare rând în cod înainte să-l construiești — gap-map-ul e o fotografie din 2026-10-11.

| prio | stare | funcție (paritate Bolt) | dovadă din cod (gap-map) |
|---|---|---|---|
| must | no | Reports and invoices export (CSV and weekly) | grep csv/text/csv/invoice/factur in src/app and src/lib: empty. Merchant only sees on-screen week gross and payout rows (earnings/page.tsx); no exp… |
| must | partial | Merchant tablet app sign-in | No tablet/native merchant app (mobile/ has only client and driver). Web PWA only: apps/restaurant/app/manifest.ts (start_url /restaurant/orders), e… |
| must | partial | Reject order with reasons | OrderQueueRow.tsx L205-225: reject requires a free-text reason (placeholder 'Motivul refuzului (obligatoriu)') -> rejectOrder action. No preset rea… |
| must | partial | Mark items available / unavailable on tablet | src/components/admin/MenuItemRow.tsx L165 + toggleItemAvailability (menu/actions.ts L228) flips menu_items.is_available from the full menu editor p… |
| must | partial | Portal login and password activation | Login: src/components/auth/LoginForm.tsx. Activation: invitePartner (src/app/(admin)/platform/restaurants/actions.ts L61) calls admin.auth.admin.in… |
| must | partial | Menu editor: categories with translations | Categories: create/delete/reorder in menu/actions.ts (createCategory, deleteCategory, moveCategory), AddCategoryForm.tsx, MenuCategoryHeader.tsx. S… |
| must | partial | Menu editor: items (name desc price image age flag tags) | AddMenuItemForm.tsx + createMenuItem/updateMenuItem (menu/actions.ts L92-188): name, description, price_mdl, category, photo upload (src/lib/storag… |
| must | partial | Opening hours and holiday mode | Weekly hours per day with closed flag: src/components/admin/HoursForm.tsx + updateHours (hours/actions.ts) into restaurant_hours; manual accepting_… |
| should | no | Busy mode (+15/30/45 min) | grep busy_until/busy_mode/mod_aglomerat/ocupat across src, supabase/migrations, packages: only an unrelated placeholder string in src/components/ad… |
| should | no | Print order (Sunmi) | grep sunmi/window.print/@media print across src, mobile/*/src, packages: empty. |
| should | no | Order history 30 days on tablet | orders/page.tsx filters QUEUE_STATUSES only (pending_restaurant..en_route); no delivered/cancelled list anywhere under src/app/(admin)/restaurant. … |
| should | no | Menu editor: timetables | No menu-level or item-level schedule columns/UI; restaurant_hours (HoursForm.tsx, hours/actions.ts) covers venue opening hours only. |
| should | no | Menu draft and publish with schedule | Edits write straight to live menu_items/menu_categories (menu/actions.ts); no draft/publish tables or UI (grep menu_draft empty). |
| should | no | Ratings and feedback with dispute | No ratings UI under src/app/(admin)/restaurant or its components (grep empty). Ratings data exists (restaurant rating distribution RPC in 202607280… |
| should | no | Refunds list with deduction dispute | grep refund/rambursar in src/app/(admin)/restaurant and src/components/admin: only a comment in PayoutMarkPaidButton.tsx (clawback = negative payou… |
| should | no | Promotions: automatic campaigns (menu % / free delivery) | No promo/discount tables or merchant UI (grep promo/discount/voucher/reducere in restaurant admin code and migrations: no merchant campaign feature… |
| should | partial | Courier details shown once assigned | src/app/(admin)/restaurant/orders/page.tsx L70-85 loads courier full_name + live position for a courier_assigned order and renders RestaurantPickup… |
| should | partial | Scheduled order start-preparation prompt | Scheduled orders are flagged 'Programată: ...' (OrderQueueRow.tsx L99-102, orders/[id]/page.tsx L70) and SLA countdown is suppressed while isSchedu… |
| should | partial | Menu editor: item availability states (4) | Only boolean menu_items.is_available (MenuItemRow.tsx, toggleItemAvailability). No scheduled/hidden/sold-out-until states. |
| should | partial | Home KPIs (sales promo spend orders rating) | No restaurant home (nav start is /restaurant/orders, PartnerNav.tsx). Pieces exist: week gross + order count (earnings/page.tsx L83-104), prep/wait… |
| could | no | Call customer from app | orders/[id]/page.tsx L33 comment: deliberately no customer PII/address for the restaurant. grep 'tel:' in src/components/admin and src/app/(admin):… |
| could | no | Own delivery mode (Ready / Picked up / Delivered) | grep own_delivery/self_delivery/livrare proprie in src, supabase/migrations, packages: empty. Delivery is always the platform courier flow. |
| could | no | Menu editor: bulk price edit | menu/actions.ts exports only per-item create/update/move/toggle/delete; grep bulk in restaurant menu code/migrations empty. |
| could | no | Menu history and deposits | No menu versioning/audit tables or UI; deleteMenuItem only archives via is_available=false when referenced (menu/actions.ts L252). No deposit concept. |
| could | no | Multi-venue switcher | src/lib/auth/require.ts L19-31 and every restaurant page take restaurant_staff ... order created_at limit(1); comment says 'A per-restaurant switch… |
| could | no | Promotions: manual campaigns (>=3 items 1 week-30 days) | Same grep as automatic campaigns: nothing. No campaign object, items selection or date-range UI. |
| could | no | POS integration via public API | src/app/api has only menu-search, platform/ai, push/drain, route; no partner-facing order/menu API, API keys or webhooks (grep api_key/webhook in m… |
| could | partial | Performance: sales and operations tabs | src/app/(admin)/restaurant/analytics/page.tsx: orders by hour, revenue by day (14d), top items (28d), wait/prep KPIs from restaurant_analytics_hour… |

## 9. Prompt de pornire (lipește-l în terminalul tău)
```
Citește integral ~/code/chisinau-delivery/docs/handoff/HANDOFF-RESTAURANT.md și lucrează pe suprafața RESTAURANT după regulile de acolo. /bucla
```

## 10. Stare RESTAURANT (BOOT nucleu, 2026-10-12)
**Ramuri.** UI-ul sectorului: ramura `sector/restaurant`, worktree `~/code/chisinau-delivery-restaurant` (checkout-ul comun nu se poate muta de pe `main` fără să rupă celelalte 3 sesiuni). Contractul comun (migrații, sim-uri, rollback-uri, tipuri, docs/handoff) intră pe `main`, separat de UI. `:3003` rulează din worktree. Baza `main` a ramurii: 22f5f3b.
**Baseline (worktree, 2026-10-12):** `tsc --noEmit` 0 erori · vitest 38 fișiere / 313 teste verzi · `npm run test:rpc` „RPC SUITE: all green” (103 fișiere) · `apps/restaurant` `next build` OK, 13 rute restaurant.
**Dovedit (commit + sim/browser):** busy mode 1297569+b4a23e7 (sim 200 B1–B11; red-team F1–F5 reparate) · card curier cu telefon f8631ef (sim 201) · istoric 30 zile + bon 58 mm 99d51f4 (sim 202, control cu politica deschisă = roșu) · „Epuizat” e278517 (sim 203) · IBAN 7c36a71 · CSV săptămânal e368a0c (unit + DB = CSV: 34 comenzi / 29 920,00) · import meniu 624d049 (unit + browser) · verificare tabletă 49cde5e (browser).
**Doar declarat (nedovedit încă):** comportamentul pe tabletă reală (nu există dispozitiv/adb/simulator pe Mac) · reconectarea realtime sub tăiere de rețea · testul de sistem cap-coadă (E2E comite date, cere OK).
**Datorie găsită la BOOT:** sim-urile 200/201/203 testează refuzurile cu `exception when others` → trec și dacă funcția lipsește (fals-verde) — de reparat la primul gate; migrațiile 000301–000304 n-au rollback scris (regula nouă) — de adăugat.
**Instrumente:** skill-ul de replică și `/debug` NU sunt instalate; matricea se face din `replica/` (recon public-only, verificat: 0 mențiuni de decompilare) + cod. Agenți: `t-verify`, `t-redteam`, `t-scan`. Ruflo: fără tool-uri în sesiune (carantină globală). Browserul Playwright MCP e ocupat de altă sesiune → Chromium headless izolat din script.
**BLOCKED:** G5 dispozitiv real (hardware) · testul de sistem `npm run test:e2e` (comite date `E2E-*`, cere OK de la user).

### G1 — calitatea pinului (2026-10-12) · DONE raport, regula = BLOCKED owner
Măsurat pe baza locală (q-urile în `.bucla/progress.md` RESTAURANT):
- Restaurante: **14/14 au pin, 0 în afara Chișinăului** (bbox 46.90–47.12 / 28.70–29.00). Premisa „pinul restaurantului lipsește” e **falsă** pe datele locale.
- Dar pinurile sunt **demo**, nu verificate: valori rotunde (Osaka 47.050000/28.810000, Amber 47.068000/28.860000…), Sakura și Nexus au coordonate identice; CLAUDE.md o spune explicit („Restaurant coordinates are demo values”).
- Cele **28 de livrări pe 6,0 km presupuși** (`orders.courier_fee_distance_assumed`) vin TOATE din partea clientului: 8 catering (catering-ul nu are pin deloc, doar `event_address_text`; 7 din 8 sunt E2E) + 20 standard din 2026-08-06 fără nicio adresă legată. 0 din cauza restaurantului.
- Gol real: `restaurants.lat/lng` sunt nullable și nimic nu leagă activarea de pin — dovedit în tranzacție anulată: `update restaurants set lat=null, lng=null, is_active=true` → reușește. Restaurantele din înscrierea proprie intră cu NULL (`platform/restaurants/actions.ts`); pinul îl pune doar adminul (Nominatim sau manual, `RestaurantLocationControl`).
**Regula propusă (decide owner-ul):** A *(recomandat)* activarea cere pin în raza de serviciu + confirmarea partenerului pe hartă („aici e ușa de ridicare”); B activarea cere doar pin pus de admin (geocodare); C status quo. A costă un pas în onboarding; B lasă pinul de geocodare (centrul clădirii, nu ușa); C lasă activarea fără pin posibilă.
**Pentru alte sectoare (în CROSS-REQUESTS):** catering fără pin (CLIENT/CURIER), comenzi standard fără adresă (CLIENT, `place_order` cu pin obligatoriu din W2).
