# CORE — Planul de bază canonic al platformei de curieri (Chișinău Delivery)

> Sursă: dezbatere multi-lentilă (6 experți + refutare + research industrie DoorDash/Uber Eats/Instacart/Wolt/Glovo/Bolt) + verificare directă pe codul curent din acest repo (2026-07-26). Orice afirmație din dezbatere care contrazicea codul a fost corectată aici cu dovada din fișier/migrație. Acest document e sursa de adevăr pentru simulator + scraper — orice parametru fără sursă verificată e marcat explicit ca estimare.
>
> Legendă: **[EXISTĂ]** = verificat în cod/migrații acum · **[PARȚIAL]** = fundație există, incomplet · **[LIPSEȘTE]** = zero implementare găsită.

---

## 0. Notă de acuratețe — drift documentație vs cod

Dezbaterea (și `CLAUDE.md` din rădăcina repo-ului) listează canalul GPS al curierului ca `KNOWN (unfixed): public channel`. **Verificat fals** — migrația `supabase/migrations/20260717002100_ws3b_private_location_channel.sql` a mutat deja canalul pe privat cu RLS pe `realtime.messages`. La fel, dezbaterea presupune "zero push notifications" — **verificat fals**: Web Push e implementat (`push_subscriptions`, `notification_outbox`, `src/app/api/push/drain/route.ts`). Concluzie operațională: **orice audit trebuie să re-verifice codul, nu doar documentele existente** — regulă permanentă pentru acest proiect.

---

## 1. Misiune + principii de design

**Misiune**: motor de dispatch curieri corect, sigur și transparent pentru piața Chișinău — suficient de simplu pentru o echipă de 1 om + agenți AI să-l opereze, suficient de solid pentru bani și siguranță fizică reală.

**Principii (max 5)**:
1. **Serverul e sursa unică de adevăr.** Nicio tranziție de stare/bani nu se decide în client — doar RPC-uri `security definer` + RLS Postgres ca graniță reală (proxy.ts = UX-gating, nu securitate).
2. **Construiește pentru scara actuală, nu pentru Uber Eats.** Piață ~500-700k locuitori, probabil 10-100 curieri activi la lansare — optimizare combinatorială (batching complex, ML scoring, microservicii) e overhead prematur; greedy simplu + recompute periodic e corect la acest volum (confirmat de precedentul Instacart pre-scale).
3. **Un backend, clienți multipli.** Un singur proiect Supabase/RLS ca sursă unică de roluri și securitate; separarea corectă e la nivel de CLIENT (web monolit vs mobil nativ curier), nu de bază de date.
4. **Siguranță și bani înaintea cosmeticii.** Fix de securitate/fraudă/plată > gamification/leaderboard — în special la pool mic de curieri unde comparația socială e demotivantă, nu motivantă.
5. **Verifică pe date reale, nu pe date demo.** Orice scoring geografic/ETA calculat pe coordonate needverificate e cosmetic, nu productie-ready.

---

## 2. Domeniul curierului: state machine completă

### 2.1 Stare cont (identitate) — separată de stare shift

```
(nimic) → onboarding_applications.status='pending' [EXISTĂ]
        → review_onboarding_application(approve) → couriers row creat + profiles.role='courier' [EXISTĂ]
        → review_onboarding_application(reject) → status='rejected' (terminal, poate reaplica) [EXISTĂ]
```
Declanșator: self-serve (`submit_onboarding_application`, `add_kyc_document`) de către aplicant; aprobare/respingere doar `platform_admin` (`review_onboarding_application`).

### 2.2 Stare shift (disponibilitate) — `couriers.status`

| Stare | Cine o declanșează | RPC/mecanism | Verificat |
|---|---|---|---|
| `offline` | curier (toggle) sau sistem (implicit la creare) | `set_courier_online_status('offline')` | [EXISTĂ] |
| `online` | curier (toggle) | `set_courier_online_status('online')` — revocat pt `public`/`anon`, doar `authenticated` | [EXISTĂ] |
| `online` + `is_active=false` | admin (dezactivare disciplinară) | update direct admin, blochează candidatura la dispatch (`c.status='online' and c.is_active` în query) | [EXISTĂ] |
| heartbeat / auto-offline la lipsă semnal | — | **niciun heartbeat separat de GPS** — dispatch-ul consideră curierul "online cu GPS valid" doar dacă `courier_locations.updated_at > now() - 10 min`, dar `couriers.status` nu se resetează automat la `offline` | [LIPSEȘTE] auto-offline pe heartbeat expirat — risc de curier "fantomă online" |

### 2.3 Ciclul unei livrări (per comandă) — orchestrat de `dispatch_offers` + `orders.status`

```
ready_for_pickup (comandă, courier_id=NULL)
        │  dispatch_order() — trigger automat la mark_ready_for_pickup [EXISTĂ]
        ▼
dispatch_offers.status='offered' (wave N, expires_at = now()+30s) [EXISTĂ]
        │
        ├─► accept_dispatch_offer() [curier] → CAS atomic:
        │      UPDATE orders SET courier_id=X WHERE status='ready_for_pickup' AND courier_id IS NULL
        │      + FOR UPDATE lock pe courier → dispatch_offers.status='accepted' [EXISTĂ]
        │      → orders.status devine implicit "assigned"/în curs (courier_id setat)
        │
        ├─► decline_dispatch_offer() [curier] → status='declined', nu blochează alte oferte [EXISTĂ]
        │
        └─► expire_dispatch_offers() [sweeper pg_cron, la 15s] → status='expired'
               → cascadă: wave+1, re-scorare, ofertă nouă altui curier (cap 5 waves) [EXISTĂ]
               → dacă wave>5: comanda rămâne `ready_for_pickup` fără ofertă live (pull-fallback, fără escaladare activă) [PARȚIAL]
        ▼
picked_up (curier confirmă) → RPC lifecycle security-definer [EXISTĂ]
        ▼
delivered (curier confirmă) → RPC lifecycle, courier redevine disponibil pentru capacitate [EXISTĂ]
        ▼
couriers.status rămâne 'online' (nu se schimbă automat status shift la delivered)
```

**Ce lipsește complet din state machine**:
- Stare explicită `pauză` (diferită de offline) — [LIPSEȘTE]
- `on_shift_busy(order_id)` ca stare vizibilă distinctă (azi capacitatea e derivată din `courier_has_capacity()`, nu e o stare persistată explicit) — [PARȚIAL]
- Batching: capacitate > 1 comandă simultană — [LIPSEȘTE] (funcția e izolată exact ca punct de extensie: comentariu în cod „Capacity in ONE place so WS5 batching only swaps this body")

---

## 3. Onboarding & verificare

**[EXISTĂ] — fundație solidă**:
- `onboarding_applications` (applicant_type courier/restaurant, status pending/approved/rejected, full_name/phone/email/details jsonb)
- `kyc_documents` (legat de application_id, doc_type, storage_path) + bucket privat Storage `kyc-documents` (RLS: upload doar propriul folder, citire doar owner sau `platform_admin` via signed URL)
- Flow RPC: `submit_onboarding_application` (self-serve, 1 pending per tip) → `add_kyc_document` (link fișier upload) → `review_onboarding_application` (admin approve/reject, la approve **promovează automat** userul la `couriers`/`restaurant_staff` + `profiles.role`)
- Formular UI: `src/app/(customer)/devino-partener/CourierApplicationForm.tsx`, admin: `src/app/(admin)/platform/onboarding/page.tsx`, `InviteCourierForm.tsx` (invitație directă de admin, bypass aplicație)

**[PARȚIAL]**:
- Tip de document (`doc_type`) e text liber, nu enum — nu forțează explicit buletin+permis+talon ca set complet obligatoriu
- Fără câmp `vehicle_type` obligatoriu legat de verificare (vehicle_type e pe `couriers`, dar nu clar cuplat la un document de verificare vehicul specific)
- Fără expirare/re-verificare periodică documente (buletin/permis expiră, sistemul nu urmărește data)

**[LIPSEȘTE]**:
- Selfie/liveness check
- Verificare cazier/antecedente
- Contract subcontractor semnat digital
- Training/quiz obligatoriu înainte de prima ofertă
- Verificare asigurare vehicul

**Recomandare pt piață mică (10-50 curieri la start)**: verificarea manuală admin (ce există) e suficientă și mai ieftină decât KYC provider automat/liveness — nu investi în automatizare KYC până volumul o cere.

---

## 4. Dispatch & oferte

### 4.1 Ce EXISTĂ — algoritm de scoring, verificat exact în `supabase/migrations/20260717001600_dispatch_offers.sql`

**Formula de scor** (mai mic = mai bun):
```sql
score = round( dist_km / speed_kmh * 60 + (1 - acceptance_rate_14d) * 10 , 2 )
```
- `dist_km` = `haversine_km(courier_lat, courier_lng, restaurant_lat, restaurant_lng)`; fallback **6.0 km** dacă GPS stale/lipsă sau restaurant negeocodat
- `speed_kmh` după `vehicle_type`: **bike=12, e_bike=18, scooter=25, car=22**, altfel **5**
- `acceptance_rate_14d` = rata de accept din `dispatch_offers` proprii ale curierului (`accepted / (accepted+declined+expired)`) în ultimele **14 zile**; **1.0** (fără penalizare) dacă nu are istoric
- Termenul de penalizare: `(1 - rate) * 10` — la rate=0 (niciodată acceptat), penalizare +10 minute echivalente în scor

**Filtre candidat** (toate obligatorii, verificate în `WHERE`):
- `couriers.status='online' AND couriers.is_active`
- `courier_has_capacity(courier_id)` = true (azi: max 1 livrare activă simultan — punct de extensie pentru batching)
- fără ofertă live curentă (`no exists ... status='offered'`)
- nu a fost deja ofertat pentru ACEASTĂ comandă (evită re-ofertă în aceeași cascadă)
- GPS considerat valid dacă `courier_locations.updated_at > now() - interval '10 minutes'`

**Timeout & cascadă**:
- Fereastră ofertă: **`expires_at = now() + interval '30 seconds'`**
- Sweeper: `cron.schedule('expire-dispatch-offers', '15 seconds', ...)` — la fiecare 15s expiră ofertele trecute de `expires_at`, cascadă la wave+1
- **Cap cascadă: `if v_wave > 5 then` stop** — după 5 valuri, comanda rămâne `ready_for_pickup` fără ofertă activă, fără escaladare (nici alertă admin, nici extindere rază)
- Claim: `accept_dispatch_offer` face **compare-and-set atomic**: `UPDATE orders SET courier_id=X WHERE status='ready_for_pickup' AND courier_id IS NULL` + `FOR UPDATE` lock pe rândul curier — elimină dublu-assign la race real

### 4.2 Ce e [PARȚIAL] / [LIPSEȘTE]

| Componentă | Stare | Detaliu |
|---|---|---|
| Fallback după wave 5 fără candidat | [PARȚIAL] | Comanda rămâne needispatch-uită, fără alertă activă admin — doar vizibilă manual în kanban |
| Weights de scoring | [PARȚIAL] | Hardcodate în SQL (constante `12,18,25,22,5` și `*10` penalizare) — orice tuning cere migrație nouă, nu config runtime |
| Batching/stacking | [LIPSEȘTE] | Zero implementare; `courier_has_capacity()` e punctul de extensie deja pregătit în cod |
| Rutare reală (nu linie dreaptă) | [LIPSEȘTE] | Scoring folosește haversine, nu distanță de rețea rutieră (străzi cu sens unic în Chișinău pot da eroare reală) |
| Surge/rebalansare cerere-ofertă | [LIPSEȘTE] | Zero mecanism — raza de ofertă e fixă (implicit tot orașul, filtrat doar de scor) |

### 4.3 Recomandare din research industrie (Instacart/DoorDash pre-scale)

La volum mic, complexitatea actuală (greedy + cascadă + sweeper) e **deja suficientă și corect dimensionată** — nu adăuga optimizare combinatorială (ruin-and-recreate, CVRPTW) până la volum real. Batching manual/opt-in (curierul alege să lege 2 comenzi din aceeași zonă) e pasul corect înainte de batching automatizat.

---

## 5. GPS & navigație

### 5.1 Pipeline actual — [EXISTĂ], verificat în `src/lib/realtime/courierLocation.ts` + `mobile/driver/src/lib/realtime/courierLocation.ts`

- **Canal**: `order:{id}:location` — **PRIVAT** (migrația `20260717002100_ws3b_private_location_channel.sql`, `config.private=true`), RLS pe `realtime.messages`: `receive` limitat la customer-ul comenzii + curierul asignat + admin; `send` limitat strict la curierul asignat
- **Frecvențe**: broadcast Realtime ~10s (poziție live pentru UI), upsert în `courier_locations` (persistat) ~45s (ultimă poziție cunoscută)
- **Plauzibilitate**: `courier_location_guard()` trigger BEFORE INSERT/UPDATE:
  - **Hard reject**: coordonate în afara cutiei Moldova (`lat NOT BETWEEN 45.4 AND 48.5 OR lng NOT BETWEEN 26.6 AND 30.2`) → `raise exception`
  - **Soft flag** (nu blochează): viteză implicită între ping-uri > **150 km/h** → insert în `fraud_flags` (kind=`gps_teleport`), append-only, doar semnal pentru admin
- **PostGIS**: `geography(point,4326)` generat pe `restaurants` și `courier_locations`, index GiST parțial pentru `nearby_restaurants`

### 5.2 [PARȚIAL] / [LIPSEȘTE]

| Componentă | Stare |
|---|---|
| Throttling adaptiv (frecvență GPS variabilă după activitate) | [LIPSEȘTE] — frecvență fixă 10s/45s indiferent de stare (online idle vs în livrare activă) |
| Foreground service Android persistent explicit + notificare vizibilă | [LIPSEȘTE] — nu confirmat în `mobile/driver` |
| Coadă offline GPS (buffer local pe semnal slab) | [LIPSEȘTE] — zero coadă locală găsită în `mobile/driver/src` |
| Navigație turn-by-turn reală | [LIPSEȘTE] — nu există integrare Directions API (Google/Mapbox/OSRM); recomandare cost-eficientă: deep-link către Google Maps/Waze cu waypoints, nu motor propriu |
| Geofence hard pe tranziții picked_up/delivered | [LIPSEȘTE] — recomandat ca soft-flag (log, nu block), dat fiind driftul GPS real în zone cu clădiri înalte din centrul Chișinăului |

**Privacy — verdictul de securitate**: fix-ul de canal privat e deja aplicat corect; recomandarea reziduală e să sincronizezi `CLAUDE.md`/documentația (marcată încă "unfixed") cu codul real, ca să nu se repete auditul fals-pozitiv.

---

## 6. Earnings & payout

### 6.1 [EXISTĂ] — verificat în `20260718000000_platform_foundation.sql` + `20260726000000_checkout_idempotency.sql`

**Formulă de payout** (exactă, din `admin_generate_payouts(p_start, p_end)`):
```
Restaurant net = subtotal_mdl_total - (subtotal_mdl_total × restaurant_commission_pct / 100)
Courier net    = (delivery_fee_mdl + tip_mdl) - (delivery_fee_mdl × courier_commission_pct / 100)
```
- `platform_settings.restaurant_commission_pct` default **20.00%**
- `platform_settings.courier_commission_pct` default **15.00%** (comisionul se aplică doar pe `delivery_fee_mdl`, NU pe tips — curierul păstrează 100% din tip)
- `payouts` are `unique(recipient_type, recipient_id, period_start, period_end)` → **idempotent**, rerun sigur pe aceeași fereastră
- Serializare: `pg_advisory_xact_lock(hashtext('admin_generate_payouts'))` — previne dublă generare la race între 2 admini
- `admin_mark_payout_paid(payout_id)` — tranziție explicită `pending → paid`
- Ecran curier: `src/app/(courier)/earnings` + `src/app/(courier)/_lib/earnings.ts` — sumar de câștiguri există în UI
- Tipping: `orders.tip_mdl` (coloană existentă, curierul ia 100%)

### 6.2 [PARȚIAL] / [LIPSEȘTE]

| Componentă | Stare |
|---|---|
| Breakdown per-comandă vizibil ÎNAINTE de accept oferta (ca la Bolt Food) | [PARȚIAL] — nu confirmat că `score`/`distance_km` din ofertă expune și suma estimată curierului |
| Ciclu payout (zilnic/săptămânal) | [PARȚIAL] — `admin_generate_payouts` acceptă orice interval de date, dar nu există job automat/cron care să-l ruleze pe un ciclu fix — e trigger manual admin |
| Cash-out instant/on-demand | [LIPSEȘTE] |
| Export fiscal descărcabil (CSV/PDF) pentru declarații curier | [LIPSEȘTE] |
| Clawback automat la refund post-payout | [LIPSEȘTE] — nicio logică găsită care generează linie negativă în ciclul următor când o comandă deja plătită e rambursată |

**Recomandare**: comision 15% curier / 20% restaurant e deja sub norma industriei (20-30%) — bun diferențiator pentru piață mică, păstrează-l vizibil ca argument de recrutare parteneri.

---

## 7. Incentive & retenție

**[LIPSEȘTE] — complet, zero implementare în schema actuală.**

Ce merită construit la scara Chișinău (10-100 curieri), în ordine de cost/beneficiu:
1. **Bonus simplu la target săptămânal** ("50 livrări/săptămână = +X MDL") — cost mic, formulă fixă și transparentă (nu variabilă/algoritmică — evită problema de "algorithmic wage discrimination" documentată de HRW 2025 pentru platforme mari)
2. **Streak zilnic** — bonus mic pentru zile consecutive online, ieftin de calculat din `couriers.status` history
3. **NU construi leaderboard/gamification social** — la pool mic (curierii se cunosc între ei), comparația socială e frecvent demotivantă, nu motor de retenție cum e la scară mare
4. **NU construi heatmap de cerere (surge zone)** — cost computațional nejustificat la volumul curent; utilă doar când există date suficiente de cerere/oră/zonă

---

## 8. Siguranță & suport

**[LIPSEȘTE] — complet, zero hit-uri în cod (`sos`, `panic`, `emergency` — nicio potrivire relevantă în `src/` sau `supabase/`).**

Acesta e cel mai serios gol de business/legal identificat unanim de toate cele 6 lentile ale dezbaterii — curierul e persoană fizică expusă pe stradă, cu bani/marfă, uneori noaptea.

**Minim viabil pentru lansare** (nu „platformă de clasă mondială" — dimensionat pentru echipă de 1 om):
- Buton apel direct către un număr de contact urgență (admin/dispatch) vizibil permanent în ecranul de livrare activă — cost de implementare ~ore, nu sprint-uri
- Flow simplu „raportează incident" legat de `order_id` curent (poză + motiv) care notifică admin prin `notification_outbox` (deja existent) și deblochează comanda fără penalizare automată de acceptance-rate
- **NU** promite SLA de „suport uman <2 min" — incompatibil cu echipa curentă; documentează realist ca „best-effort în orele active"

---

## 9. Anti-fraudă

### 9.1 [EXISTĂ] — verificat în `20260717001700_ws10_gps_plausibility.sql` + `20260717001900_ws3_postgis_geo.sql`

- `fraud_flags` — tabel append-only, `kind text` (deliberat open-ended, nu enum — cost mic să adaugi tipuri noi), RLS admin-read only
- Trigger `courier_location_guard`:
  - Hard reject coordonate în afara Moldovei (graniță geografică fizică, previne date corupte)
  - Soft flag `gps_teleport` la viteză implicită **>150 km/h** între ping-uri consecutive
- Design corect confirmat de toate lentilele: **semnal, nu blocaj** — nu suspendă curierul automat, doar loghează pentru admin

### 9.2 [LIPSEȘTE] — vectori de fraudă neacoperiți

| Vector | Detecție recomandată | Prioritate |
|---|---|---|
| Confirmare `picked_up` fără prezență fizică la restaurant | Geofence **soft** (flag, nu block — GPS drift urban face hard-block riscant) | Medie |
| Mock-location / GPS spoofing | Verificare provider locație pe device (nu doar viteza) | Joasă la volum curent (curieri KYC-verificați manual) |
| Multi-cont / cont partajat | Device fingerprinting | Joasă — disproporționat la <100 curieri; verificarea manuală la onboarding acoperă 90% |
| Accept-decline pattern suspect (farming bonusuri) | Cross-check acceptance/cancel rapid repetat | Joasă până se implementează incentive (secțiunea 7) |
| Cash mismatch (COD) | Reconciliere cash colectat vs comenzi cash asignate | Medie — relevant doar dacă modelul de plată include cash-on-delivery |

**Recomandare de prioritizare**: nu investi în device fingerprinting/liveness la scara actuală — verificarea umană la onboarding (secțiunea 3) e mai ieftină și suficientă. Extinde `fraud_flags.kind` cu tipuri noi e cost marginal (schema deja open-ended).

---

## 10. Metrici operaționale

**[PARȚIAL]** — există vederi admin (`20260717001800_admin_ops_views.sql`, `20260717002400_backtest2_hardening.sql`) cu `acceptance_rate_7d` calculat, dar fără dashboard agregat dedicat de operare zilnică. Definiții exacte recomandate pentru simulator/scraper:

| Metrică | Definiție formulă | Sursă date |
|---|---|---|
| **Acceptance rate** | `count(status='accepted') / count(status IN ('accepted','declined','expired'))` pe fereastră (7d/14d) | `dispatch_offers` |
| **Completion rate** (mai importantă decât acceptance — vezi §recomandare) | `count(status='delivered') / count(status='accepted')` pe curier | `orders` + `dispatch_offers` |
| **Time-to-accept (TTA)** | `accepted_at - offered_at`, mediană + p90 | `dispatch_offers` (necesită coloană `accepted_at` — de verificat/adăugat) |
| **Time-to-assign (D2R = Dispatch-to-Ready)** | `courier assigned_at - ready_for_pickup_at`, cât timp stă o comandă needispatch-uită | `orders` + `dispatch_offers` |
| **Delivery time percentiles** | `delivered_at - accepted_at`: p50/p90/p99, pe zonă și oră | `orders.status_events` / `delivery_status_events` |
| **On-time rate** | `count(delivered_at <= promised_eta) / count(delivered)` | `orders` + `restaurant_prep_stats` |
| **Utilization curier** | `livrări finalizate / ore online` per curier | `couriers` shift log (necesită tracking explicit al intervalelor online — azi nu există istoric persistat al tranzițiilor shift) |
| **Churn curieri** | `curieri fără nicio livrare în ultimele N zile / total curieri activi` | `couriers` + `orders` |
| **Wave-drop-off rate** | `count(wave>1) / count(total oferte)` — cât de des candidatul #1 refuză | `dispatch_offers` |

**Recomandare politică** (din research DoorDash/Uber Eats): **nu lega deactivarea de acceptance rate** (curierii au dreptul legal să refuze) — folosește **completion rate** ca metrică de risc real, cu prag generos (85-90%), exact ca industria.

---

## 11. Arhitectura tehnică recomandată

### 11.1 Stare actuală confirmată (`docs/architecture.md`, verificat cod)

```
Supabase (proiect unic, RLS = graniță de securitate)
   ▲            ▲              ▲
Web Next.js   mobile/client   mobile/driver
(3 route      (Expo RN)       (Expo RN)
groups: customer/courier/admin)
```

- **Un backend, trei clienți** — deja aliniat cu modelul real al industriei (Uber/DoorDash/Wolt/Glovo au 3+ clienți peste backend partajat/unic la scara lor incipientă)
- `mobile/driver` (Expo) **există deja** ca aplicație separată, nu doar prototip — are `MapScreen`, `api.ts`, `supabase.ts`, dependențe native (`react-native-maps`, `async-storage`) — dar canalul GPS confirmat migrat și acolo (`mobile/driver/src/lib/realtime/courierLocation.ts`)
- `/enter/[role]` demo doorway **încă în cod**, documentat explicit în `docs/architecture.md` ca „de șters la lansare" — [ACȚIUNE cerută înainte de trafic real]

### 11.2 Verdict Q2 sintetizat din toate cele 6 lentile (convergență + refutare)

**Nu sparge în 3 platforme/backend-uri separate acum.** Argumentul comun supraviețuitor tuturor atacurilor: separarea corectă e de CLIENT (repo/app), nu de backend — 1 Supabase/RLS partajat rămâne sursa unică de adevăr indiferent de câte front-end-uri există. Motivul pentru mobil nativ separat la curier (nu route group web) e o constrângere reală de OS (GPS background, foreground service, push nativ), nu o alegere de gust arhitectural.

**Ajustare de prioritate temporală** (contribuția cea mai utilă a refutării): NU migra suprafața curier complet pe `mobile/driver` ACUM ca prioritate #1 — riscul de a întreține 2 codebase-uri paralele (web courier route group + Expo) fără un pachet de tipuri partajate e real și necontestat. Ordinea corectă de investiție:
1. Scoate `/enter/[role]` din build de producție
2. Populează coordonate restaurant verificate (secțiunea 4 depinde de ele pentru scoring corect)
3. Adaugă coadă offline minimă (chiar și `IndexedDB` pe web, nu doar mobil) pentru GPS/status în gap-uri de semnal
4. Abia apoi investește timp de dezvoltare susținut în `mobile/driver` ca suprafață canonică — declanșat de dovadă reală de volum (>30-50 curieri simultani), nu preventiv

### 11.3 Recomandare pachet shared types

Fără un layer de cod partajat (tipuri TypeScript generate din schema Supabase + client API tipizat pentru RPC-uri) între Next.js web și `mobile/driver`/`mobile/client` Expo, orice schimbare de contract RPC (ex. status nou în lifecycle) trebuie reimplementată manual în ≥2 locuri — [LIPSEȘTE], recomandat ca parte a arhitecturii de bază, nu ca „nice-to-have" final.

---

## 12. Parametri pentru SIMULATOR

| Parametru | Valoare default (Chișinău) | Interval de explorat | Sursă |
|---|---|---|---|
| `offer_timeout_s` | 30 | 15–45 | verificat cod (`interval '30 seconds'`) |
| `wave_cap` | 5 | 3–7 | verificat cod (`if v_wave > 5`) |
| `sweeper_interval_s` | 15 | 10–30 | verificat cod (`cron.schedule ... '15 seconds'`) |
| `acceptance_window_days` | 14 | 7–30 | verificat cod (`interval '14 days'`) |
| `acceptance_penalty_weight` | 10 | 5–20 | verificat cod (`(1-rate)*10`) |
| `speed_bike_kmh` | 12 | 10–15 | verificat cod |
| `speed_ebike_kmh` | 18 | 15–22 | verificat cod |
| `speed_scooter_kmh` | 25 | 20–30 | verificat cod |
| `speed_car_kmh` | 22 | 18–30 | verificat cod |
| `speed_default_kmh` (vehicul necunoscut) | 5 | 5–10 | verificat cod |
| `fallback_dist_km_no_gps` | 6.0 | 3–10 | verificat cod |
| `courier_location_stale_min` | 10 | 5–15 | verificat cod (`interval '10 minutes'`) |
| `gps_teleport_threshold_kmh` | 150 | 100–200 | verificat cod (fraud_flags trigger) |
| `moldova_bounds_lat` | 45.4–48.5 | fix (geografic) | verificat cod |
| `moldova_bounds_lng` | 26.6–30.2 | fix (geografic) | verificat cod |
| `gps_broadcast_interval_s` | ~10 | 5–20 | verificat cod (comentariu CLAUDE.md) |
| `gps_upsert_interval_s` | ~45 | 30–90 | verificat cod (comentariu CLAUDE.md) |
| `restaurant_commission_pct` | 20.00 | 10–30 | verificat cod (`platform_settings` default) |
| `courier_commission_pct` | 15.00 | 10–25 | verificat cod (`platform_settings` default) |
| `delivery_fee_mdl` (per restaurant, implicit la aprobare courier→restaurant onboarding) | 40 | 20–60 | verificat cod (`coalesce(..., 40)`) |
| `prep_stats_window_days` | 28 (curățare la 35) | 14–35 | verificat cod (`restaurant_prep_stats`) |
| `prep_stats_refresh_interval_min` | 15 | 5–30 | verificat cod (`cron.schedule` refresh) |
| `courier_capacity_concurrent` | 1 (batching dezactivat) | 1–3 (când WS5 e construit) | verificat cod (punct de extensie izolat) |
| `stale_order_expire_min` (pending_restaurant timeout) | necesar de citit din `state_machine_hardening.sql` (per-minut sweeper) | — | verificat parțial |
| `sos_response_target_min` | N/A (nu există sistem SOS) | — | estimare pentru roadmap, nu în cod |
| `courier_pool_size_launch` (estimat piață) | 10–50 | 10–200 | estimare research (nu verificabil în cod) |

---

## 13. Roadmap în faze cu criterii de ieșire

### Faza 0 — Hardening pre-lansare (blocante de securitate/legal, cost mic)
- Scoate `/enter/[role]` din build de producție
- Sincronizează `CLAUDE.md`/`docs/architecture.md` cu codul real (canal GPS deja privat, Web Push deja implementat) — elimină drift documentație/audit
- Verifică/adaugă `accepted_at` pe `dispatch_offers` pentru metrica Time-to-Accept
- **Criteriu de ieșire**: zero rută de auth-bypass în producție + documentație = cod verificat

### Faza 1 — Date reale + siguranță minimă
- Coordonate restaurant verificate (geocodare reală, nu seed demo)
- Buton SOS/apel urgență + flow raportare incident minim (secțiunea 8)
- Auto-offline pe heartbeat expirat (fix stare shift „fantomă")
- **Criteriu de ieșire**: scoring dispatch validat pe geografie reală Chișinău + curier are cale de escaladare în <60s pentru incident

### Faza 2 — Pilot cu curieri reali (10-30)
- Coadă offline minimă (web IndexedDB sau Expo SQLite) pentru status/GPS în gap-uri de semnal
- Breakdown earnings per-comandă vizibil înainte de accept ofertă
- Dashboard metrici operaționale minim (acceptance/completion rate, TTA, on-time rate — secțiunea 10)
- **Criteriu de ieșire**: 2+ săptămâni de trafic real fără incident de dublu-assign sau plată greșită

### Faza 3 — Retenție & eficiență
- Bonus simplu la target săptămânal (secțiunea 7, fără leaderboard)
- Batching manual/opt-in (curier alege să lege 2 comenzi din aceeași zonă) — validează UX înainte de automatizare
- Clawback automat payout la refund post-plată
- **Criteriu de ieșire**: cel puțin 1 lună de date de utilizare curier pentru a decide dacă batching automat se justifică

### Faza 4 — Scalare (declanșat de volum, nu de calendar)
- Migrare completă `mobile/driver` la suprafață canonică curier (cu pachet shared types deja construit din Faza 0-2)
- Push notifications native FCM/APNs (dacă Web Push actual nu mai acoperă retenția)
- Motor de rutare reală (Mapbox/OSRM) pentru ETA și navigație
- **Criteriu de intrare** (nu de calendar): >30-50 curieri activi simultan SAU reclamații măsurabile de tracking pierdut pe Web Push/PWA — nu migra preventiv fără dovadă de volum
