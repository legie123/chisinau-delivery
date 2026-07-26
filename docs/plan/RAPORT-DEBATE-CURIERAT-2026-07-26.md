# Raport Final — Dezbatere Multi-Expert: Arhitectura de Curierat, Chisinau Delivery

**Data:** 2026-07-26
**Metoda:** 7 lentile de expert independente (marketplace-architect, dispatch-logistics, courier-ops-economics, restaurant-ops, security-payments-fraud, mobile-scale-infra) au evaluat codul, au dat verdict pe intrebarea 1-app-vs-3-platforme, au proiectat nucleul de curier, apoi fiecare lentila a fost atacata cu contraargumente (refutation) verificate impotriva codului. Redactorul acestui raport a verificat suplimentar 3 fapte critice direct in repo (`git`/`grep`/`find`), rezultate marcate explicit mai jos cu **[VERIFICAT]**.

---

## 0. Corectie critica gasita prin verificare directa in cod (citeste asta primul)

Cinci din sapte lentile au listat drept **top risc de securitate** faptul ca locatia GPS a curierului e transmisa pe un canal Realtime PUBLIC (`order:{id}:location`) — susceptibil ca orice client cu UUID-ul comenzii sa asculte locatia curierului in timp real. Doua lentile (dispatch-logistics si mobile-scale-infra), plus verificarea independenta facuta pentru acest raport, au confirmat ca **afirmatia e stale**:

- **[VERIFICAT]** `supabase/migrations/20260717002100_ws3b_private_location_channel.sql` exista pe disc si face exact fix-ul: canalul devine `private` (`config.private = true`), cu doua politici RLS pe `realtime.messages` — `courier_location_receive` (doar customer-ul comenzii, curierul asignat, sau admin pot asculta) si `courier_location_send` (doar curierul asignat poate emite).
- **[VERIFICAT]** `src/lib/realtime/courierLocation.ts` seteaza client-side `config: { private: true } }` si apeleaza `supabase.realtime.setAuth()` inainte de subscribe/broadcast — implementarea e completa pe ambele parti (DB + client), nu doar migratia goala.
- **[VERIFICAT]** `CLAUDE.md` (memoria de proiect) inca marcheaza acest item ca **"KNOWN (unfixed)"** — deci exista **drift documentatie/cod real**: fix-ul e livrat, dar nota din memoria proiectului nu a fost actualizata.

**Implicatie pentru acest raport:** severitatea si ordinea de prioritate a riscurilor de mai jos au fost recalibrate tinand cont de aceasta corectie. Scurgerea GPS **nu mai e** top risc activ — e un fix deja livrat care are nevoie doar de sincronizare documentatie + un test E2E de confirmare (canal privat + RLS pot avea regresii silentioase la orice migratie viitoare). Lectia mai larga, ridicata corect de 2 din 7 lentile: **orice audit trebuie sa verifice codul, nu doar `CLAUDE.md`/rezumate** — alte "known issues" documentate pot fi la fel de stale.

Alte 3 fapte verificate direct pentru acest raport (nu doar afirmate in dezbatere):
- **[VERIFICAT]** `src/app/enter` exista pe disc — demo doorway-ul de auth-bypass e real, nu ipotetic.
- **[VERIFICAT]** `mobile/client` si `mobile/driver` exista ca aplicatii Expo separate si reale (nu prototipuri goale) — au ecrane, client API, `@react-native-async-storage/async-storage` ca dependinta.
- **[VERIFICAT]** Zero cod de push notifications (`FCM`/`expo-notifications`/`APNs`) in `mobile/driver/src` sau `mobile/client/src` — gap-ul e real, nu presupus.
- **[VERIFICAT]** Zero coada offline (SQLite/queue de retry) in `mobile/driver/src` dincolo de `AsyncStorage` ca dependinta declarata — nu exista logica de sync/retry vizibila.
- **[VERIFICAT post-sinteza]** Web Push pe WEB exista deja cap-coada: dependinta `web-push`, `public/sw.js`, `PushOptIn.tsx`, trigger pe insert in `dispatch_offers` → `notification_outbox` (migratia `20260718000200`) → `/api/push/drain`. Gap-ul real de push e DOAR pe app-urile Expo (FCM/APNs) plus verificarea E2E a fluxului web. Orice actiune "implementeaza Web Push" din acest raport se citeste deci "verifica E2E si activeaza Web Push-ul existent".

---

## 1. Executive Summary

### 1.1 Verdict Q1 — Starea arhitecturii actuale
Toate cele 7 lentile converg: nucleul tehnic (lifecycle RPC-only security-definer, dispatch push cu claim atomic + sweeper, RLS ca granita reala, PostGIS real) e **de calitate reala, nu de demo**. Fragilitatile identificate consecvent (batching absent, push nativ absent pe mobile — Web Push pe web exista deja, vezi sectiunea 0 —, date demo la restaurante, canal GPS — corectat mai sus) sunt reale ca gap-uri, dar dezbaterea (faza de refutation) a aratat ca **severitatea/urgenta lor a fost sistematic supraestimata** pentru scara actuala (echipa de 1 om + agenti AI, piata Chisinau ~500k locuitori, probabil 10-50 curieri activi la lansare). Vezi sectiunea 2 pentru lista consolidata.

### 1.2 Verdict Q2 — 1 app vs 3 platforme (VERDICTUL FINAL, cantarit)
**7 din 7 lentile au dat verdict hibrid, si acesta a fost cel mai puțin atacat cu succes dintre toate pozitiile.** Verdictul final, dupa cantarirea tuturor argumentelor si refutarilor:

> **Pastreaza UN monolit Next.js (customer + admin + restaurant, route groups peste UN Supabase/RLS partajat).** Curierul e deja pe drumul corect ca **aplicatie mobila nativa separata** (`mobile/driver` Expo exista deja) — dar **nu grabi promovarea ei la "canonica"** inainte de a rezolva gap-urile ieftine (push, offline, demo doorway) si inainte de a avea dovada reala de volum care sa justifice costul dublei intretineri. **Cel mai mare gap nedisputat de nimeni:** nu exista pachet de tipuri/client API partajat (monorepo workspace) intre Next.js si Expo — asta trebuie construit ACUM, indiferent de ce se decide despre canonicitate, ca sa nu se acumuleze schema drift intre cele doua stack-uri.

Justificare pe scurt (detaliu complet in sectiunea 3):
- **Deploy/echipa/cost:** 1 backend + RLS partajat = 1 sursa de adevar pentru autorizare; 3 platforme complet separate (3 backend-uri) ar tripla suprafata de coordonare fara beneficiu la volumul curent — niciun expert nu a putut sustine altfel dupa refutare.
- **Mobile stores — singura separare obligatorie tehnic:** curierul are nevoie de GPS in fundal + push + camera, ceea ce web/PWA nu poate oferi robust pe iOS. De aici, aplicatia nativa de curier e corecta ca directie — dar e o directie, nu o urgenta: la <50 curieri activi, un curier tine telefonul cu ecranul aprins pe suport (exact cum navigheaza cu Waze), deci constrangerea de "GPS cu ecranul stins" nu e inca blocanta.
- **Industria (research, sectiunea 5):** Uber, DoorDash, Wolt, Glovo au TOATE inceput monolit si au migrat la microservicii/app-uri separate DUPA ce volumul si echipele au cerut-o — nu de la lansare. Wolt recomanda explicit: observabilitate inainte de scalare, rollout gradual, "nu adauga read-replicas preventiv, doar cand testele de load arata nevoia."

### 1.3 Ce sa faci in primele saptamani (rezumat; detaliu in sectiunea 7)
Sincronizeaza documentatia cu codul (GPS deja fixat) → scoate `/enter/[role]` → date reale de restaurant → pachet de tipuri partajat web/Expo → verifica E2E Web Push-ul existent (nu FCM/APNs inca) → coada offline minima → earnings breakdown + buton SOS simplu → dashboard minim de metrici → batching manual/opt-in → test de concurenta + load test inainte de trafic real.

---

## 2. Evaluarea aplicatiei actuale (consolidat, dedup, cu acord intre experti)

Legenda: **[N/7]** = numarul de lentile care au identificat independent acelasi punct (aproximativ, din materialul brut).

### 2.1 SOLID — nucleu de calitate, confirmat de (aproape) toate lentilele

| Componenta | Descriere tehnica | Acord |
|---|---|---|
| Lifecycle comenzi RPC-only, security-definer | Toate tranzitiile de status (`pending_restaurant → ... → delivered`) trec exclusiv prin RPC-uri; clientul nu poate `.update()` direct pe `orders`. `delivery_status_events` nu are insert policy — doar RPC-urile scriu. | 7/7 |
| Dispatch atomic claim + sweeper | `accept_dispatch_offer` face compare-and-set (`WHERE status='ready_for_pickup' AND courier_id IS NULL`), index unic partial pe `order_id` SI pe `courier_id` in `dispatch_offers` (o oferta live per comanda, una per curier). Sweeper `pg_cron` la 15s expira ofertele de 30s, cascadeaza (max 5 waves), re-dispatch-uieste comenzi orfane. | 7/7 |
| RLS Postgres = granita reala | `proxy.ts`/middleware e doar UX-gating; enforcement-ul real e RLS + `has_role()`/`has_restaurant_access()` in Postgres. | 7/7 |
| PostGIS real | `geography` columns + GiST index, `nearby_restaurants`, guard hard pe Moldova-bounds + teleport flag — nu haversine ad-hoc in JS. | 7/7 |
| ETA dinamic din date reale de operare | `restaurant_prep_stats` rolling 28 zile, bucketat pe ora — nu ETA static hardcodat. | 6/7 |
| GPS fraud signal | Trigger `check_gps_plausibility()` BEFORE UPDATE, semnal-only (nu blocheaza), flag la >150km/h, debounce 5 min, floor 0.3km/5s. | 6/7 |
| Integritate financiara de baza | Checkout idempotency, `payout_lock` cu `pg_advisory_xact_lock` (previne double-payout la generare concurenta), ratings RPC-only denormalizat. | 5/7 |
| Canal GPS privat + RLS pe realtime.messages | **[VERIFICAT — vezi sectiunea 0]** Fixat, contrar documentatiei de proiect. | verificat direct |

### 2.2 FRAGIL — exista, dar cu limitari reale (severitate recalibrata dupa refutare)

| Componenta | Fragilitate | Severitate reala la scara Chisinau (10-50 curieri) |
|---|---|---|
| Batching/stacking (WS5) | Amanat explicit; `courier_has_capacity()` e punctul de extensie deja izolat corect. | **Medie, nu critica** — la volum mic, ferestrele de batching (restaurante <500m, timing compatibil) sunt rare; multiple refutari independente ajung la aceeasi concluzie: e optimizare prematura acum, prioritate reala abia la volum. |
| Push notifications native (FCM/APNs) | Absente pe Expo — **[VERIFICAT]** 0 hit-uri in `mobile/*/src`. Pe WEB insa Web Push exista deja (outbox → `/api/push/drain` → `sw.js`), deci oferta de 30s ajunge si cu tabul in fundal pe Android/desktop; limita reala ramane iOS. | **Medie** — real risc la scara mare, dar la pool mic de curieri "cunoscuti", solutie operationala (app deschis in tura) + Web Push sunt mult mai ieftine decat integrare FCM/APNs completa. |
| `/enter/[role]` demo doorway | **[VERIFICAT]** Exista pe disc. | **Igiena, nu breach de date** — RLS e granita reala; doorway-ul da UI unui rol, nu drepturi RLS. Totusi trebuie scos inainte de trafic real (cost mic, risc de UX-confusion). |
| Coordonate restaurant demo/fake | Orice scoring/ETA/PostGIS calculat acum e cosmetic pana la date reale. | **Ridicata** — blocheaza orice validare reala, cost de fix mic (geocodare). |
| Scoring dispatch cu weights hardcodate in SQL | `round(dist/speed*60 + (1-rate)*10, 2)` — fara knob de tuning, fara A/B. | **Joasa la volum mic** — util de externalizat cand ai date sa il tunezi, nu urgent acum. |
| ETA pe haversine, nu retea rutiera reala | Poate devia 10-30% fata de ruta reala in strazi cu sens unic. | **Joasa-medie** — Chisinau e relativ dens, fara bariere geografice majore; impactul practic e probabil spre extremitatea joasa a intervalului. |
| Zero payment gateway real | `payment_status` e actualizat manual de admin (`admin_update_payment_status`); nu exista PSP/capture/refund/chargeback flow. | **Medie in Moldova** — COD/manual e model de business viabil la volum mic; devine urgent doar cand volumul/disputele cresc. |
| Doua codebase-uri paralele pt curier (web route group + Expo) fara shared types | Risc de schema drift intre Next.js si Expo pe contractul RPC. | **Ridicata ca risc pe termen mediu** — cel mai putin disputat gap din toata dezbaterea. |

### 2.3 LIPSA — nimic construit inca (prioritizare in sectiunea 4)

- Suport & siguranta curier: buton SOS, escaladare admin, protocol incident
- Anti-frauda dincolo de viteza GPS: mock-location, self-delivery, no-show rate, multi-cont
- Offline-first mobil: coada locala de evenimente + sync la reconectare — **[VERIFICAT]** absent
- Earnings & payout transparent: breakdown per livrare, cash-out, extras fiscal
- Incentive/gamification: quests, streak, leaderboard
- Metrici operationale: acceptance rate, time-to-assign, on-time rate, dashboard
- Onboarding/verificare identitate curier (KYC minim)
- Rutare reala turn-by-turn (OSRM/Mapbox Directions) — deep-link catre Maps e alternativa low-cost
- Contracte legale/fiscale curieri (Moldova) — dimensiune non-tech, ciclu diferit (avocat, nu sprint)
- Load-testing sub concurenta reala (accept-race, 50-100 comenzi/ora)

---

## 3. Dezbaterea "1 app vs 3 platforme" — pozitii, contraargumente, verdict final

### 3.1 Pozitiile initiale (rezumat per lentila)

| Lentila | Verdict initial | Argument central |
|---|---|---|
| marketplace-architect | Hibrid: 1 monolit web + mobile/client+driver separate | Deploy/auth/cost unificat pe web; mobile store constraints forteaza nativ pt curier |
| dispatch-logistics | Hibrid: 1 app web + Expo separat; propune portal merchant ca prima extractie | Contract RPC unic (place_order/accept_dispatch_offer) evita schema drift |
| courier-ops-economics | Hibrid, cel mai bine sustinut argumentat prin precedent industrie | Uber/DoorDash/Wolt/Glovo = clienti separati peste backend partajat, NU 3 backend-uri |
| restaurant-ops | Hibrid: 1 app web, mobil nativ curier | RLS partajat + realtime cross-surface fara hop de retea intre servicii |
| security-payments-fraud | Hibrid, dar semnaleaza portalul restaurant B2B ca posibil candidat mai timpuriu | Separare la nivel de CLIENT, nu de backend/DB |
| mobile-scale-infra | Hibrid pe termen lung, dar **timing gresit** — nu promova Expo la canonic ACUM | GPS in fundal cere native, dar migrarea completa e cost mare pt echipa de 1 om |

### 3.2 Ce a "murit" sau s-a slabit in refutare (cele mai importante)

1. **Contradictia interna a marketplace-architect** (KILLS-IT): a respins split-ul in 3 platforme web pe motiv de "overhead prematur la echipa de 1 om", dar a recomandat exact acelasi tip de overhead (2 codebase-uri, web+Expo) fara sa mentioneze strategia de partajare a codului. → Concluzie: verdictul hibrid e corect DOAR daca vine cu disciplina de shared-types; fara ea, e aceeasi problema la scara mica.
2. **Circularitatea security-payments-fraud** (KILLS-IT): a validat status-quo-ul ("mobile/ Expo deja separat = alinierea corecta") fara sa testeze alternative reale, ca portalul restaurant B2B — cel mai comun si mai timpuriu split la marketplace-uri reale, pentru ca restaurantele au audienta si nevoi UX total diferite fata de admin.
3. **Riscul de conexiuni concurente Supabase Realtime** (WEAKENS, la limita KILLS): "sute de curieri cu canal live" e cifra nefondata la scara Chisinau (probabil 50-200 curieri activi in varf); daca apare, e decizie de billing tier, nu de redesign arhitectural.
4. **Q3 "clasa mondiala" aplicat literal** (WEAKENS repetat, in 4 din 7 refutari): SOS <60s, suport <2 min, device fingerprinting, leaderboard, KYC cu liveness check — toate simultan "obligatorii" pentru o echipa de 1 om + AI agents e o capcana de perfectionism care ar bloca lansarea la nesfarsit. Mai grav: leaderboard-urile intr-un pool mic de 20-30 curieri care se cunosc sunt frecvent **demotivante** (comparatie sociala toxica), nu motor de retentie.
5. **Batching ca "prioritate #1"** (WEAKENS in 3 refutari): la densitate mica de comenzi simultane, motorul de batching ar rula gol majoritatea timpului — ordinea corecta e metrici → push → batching, nu invers.
6. **Push FCM/APNs ca "blocant de nivel 1"** (WEAKENS): la pool mic si cunoscut de curieri, practica operationala ("app deschis in tura") + Web Push (fara appstore, cost mic) acopera nevoia mult mai ieftin decat integrare nativa completa.
7. **KYC cu liveness check ca "blocant legal in Moldova"** (WEAKENS): afirmatie fara citare de lege moldoveneasca; verificare manuala (buletin + interviu, admin uman) e suficienta si mult mai ieftina la 10-50 curieri.

### 3.3 Ce supravietuieste neschimbat (consens robust, nu doar afirmatie)

- Dispatch atomic (compare-and-set) + sweeper 15s + scoring haversine ETA — nucleu tehnic solid, verificat, neatacat cu succes de nimeni.
- RLS + RPC-only ca granita reala de securitate.
- PostGIS real (geography + GiST + Moldova-bounds guard) fata de haversine ad-hoc in JS.
- Directia generala: NU sparge suprafetele WEB (customer/admin/restaurant) in platforme separate la stadiul actual.
- Mobil nativ pentru curier e directia corecta pe termen lung (constrangere de OS, nu preferinta arhitecturala).
- Lipsa pachetului de tipuri partajat (monorepo workspace) intre Next.js si Expo = riscul #1 de drift, necontestat de nicio lentila.
- `/enter/[role]` trebuie scos — doar severitatea ("breach" vs "igiena") a fost recalibrata.

### 3.4 Ce spune industria (sinteza research, detaliu cu surse in sectiunea 5)

- Uber, DoorDash, Wolt, Glovo au **3+ aplicatii client separate** (consumer/courier/merchant) — dar **peste un backend partajat** care a ramas monolitic mult mai mult timp decat cred oamenii din exterior. Migrarea la microservicii a venit DUPA probleme reale de crestere (DoorDash: monolit Python pana in 2019-2020; Uber: 2 servicii monolitice pana in 2012-2013).
- Wolt recomanda explicit, pentru echipe mici: observabilitate inainte de a scala, rollout gradual prin feature-flag (10%→100%), **nu adauga read-replicas/caching preventiv — doar cand testele de load reale arata nevoia**.
- DoorDash: recompute periodic + decizie just-in-time (nu matching instant per-comanda) — pattern reproductibil simplu la scara mica.

### 3.5 Verdict final Q2 (cantarit, cu plan de evolutie in etape)

**Faza actuala (0-50 curieri activi, echipa 1 om + AI):**
- 1 monolit Next.js (route groups `(customer)`/`(restaurant)`/`(admin)`), 1 proiect Supabase/RLS.
- `mobile/driver` si `mobile/client` Expo raman **prototip/experimental**, NU canonic — investeste minim, doar imbunatatiri non-native (Web Push, Wake Lock API, coada offline via IndexedDB pe web).
- Construieste ACUM pachetul de tipuri/client API partajat (monorepo workspace) intre Next.js si Expo — indiferent de decizia de canonicitate, e cel mai ieftin fix cu impact pe termen lung.
- Nu extrage NIMIC (nici dispatch, nici portal restaurant) pana nu exista dashboard de metrici operationale — decizia "ce se extrage primul" nu se poate lua fara datele care astazi nu exista.

**Faza 2 (volum real dovedit — reclamatii de tracking pierdut, >30-50 curieri simultani, sau restaurante partenere care cer onboarding B2B propriu):**
- Promoveaza `mobile/driver` la canonic: foreground service Android, push nativ FCM/APNs, Play Integrity/App Attest.
- Evalueaza portal web B2B separat pentru restaurante (candidat mai probabil decat "dispatch ca microserviciu", pentru ca diferenta de audienta — extern vs intern — justifica UX/onboarding diferite mai timpuriu decat orice presiune de scalare tehnica).

**Faza 3 (scalare reala, multi-oras):**
- Doar aici (nu inainte) devine relevanta discutia de microservicii/dispatch-engine separat, daca `pg_cron` 15s + RPC-uri sincrone devin efectiv bottleneck — masurat, nu presupus.

---

## 4. Planul complet al ecosistemului (clienti → restaurante → curieri): faze, prioritati, dependente

### FAZA 0 — Inainte de orice trafic real (cost mic, blocant)
| # | Actiune | Dependinta | De ce blocant |
|---|---|---|---|
| 0.1 | Sincronizeaza `CLAUDE.md`/known-issues cu codul (GPS deja fixat) | — | Previne investitie de timp pe risc fantoma |
| 0.2 | Scoate `/enter/[role]` din build de productie | — | Igiena pre-launch, cost minim |
| 0.3 | Populeaza coordonate reale de restaurant (geocodare) | — | Orice test de dispatch/ETA e cosmetic fara asta |
| 0.4 | Pachet de tipuri/client API partajat Next.js↔Expo | mobile/driver, mobile/client | Previne schema drift pe RPC-uri de lifecycle |
| 0.5 | Onboarding curier minim (verificare manuala buletin, nu KYC provider automat) | — | Blocheaza dispatch pana la `approved=true` |

### FAZA 1 — Primele luni (volum mic, 10-50 curieri)
| # | Actiune | Dependinta | Impact |
|---|---|---|---|
| 1.1 | Verifica E2E + activeaza Web Push-ul existent pentru oferte (opt-in curieri; FCM/APNs nu inca) | outbox + sw.js existente | Reduce oferte ratate fara cost de appstore |
| 1.2 | Coada offline minima (IndexedDB web / AsyncStorage+queue Expo) | 0.4 | Previne pierderea de update-uri in zone cu semnal slab |
| 1.3 | Earnings breakdown per livrare, vizibil curierului | payout_lock existent | Incredere/retentie, cost mic |
| 1.4 | Buton SOS simplu (apel + notificare admin prin outbox existent) | — | Risc legal/reputational, cost mic |
| 1.5 | Dashboard minim de metrici (acceptance rate, time-to-assign, on-time rate) | admin ops views existente | Necesar INAINTE de orice decizie de batching/extractie |
| 1.6 | Batching manual/opt-in (nu automat) | `courier_has_capacity()` | Valideaza UX cu curieri reali inainte de scoring automat |
| 1.7 | Test de concurenta (accept-race) + load test 50-100 comenzi/ora | dispatch existent | Verifica ce e validat teoretic e valid si sub sarcina |

### FAZA 2 — Cand volumul creste (dovada reala de nevoie)
| # | Actiune | Trigger |
|---|---|---|
| 2.1 | Batching automat cu scoring | Volum >15-20 comenzi/ora/zona |
| 2.2 | PSP local (maib/Paynet) cu capture/refund/clawback | COD nu mai e suficient / dispute cresc |
| 2.3 | Gamification minima (quest saptamanal simplu, NU leaderboard) | Retentie curieri sub prag acceptabil |
| 2.4 | Anti-frauda extinsa (geofence SOFT-flag, no-show rate) | Volum + primele incidente reale |
| 2.5 | Portal B2B separat pentru restaurante | Nr. restaurante partenere justifica onboarding propriu |
| 2.6 | Rutare reala (OSRM self-hosted / Mapbox Directions) | Buget disponibil; impact 10-20% pe ETA |

### FAZA 3 — Scalare reala (sute de curieri, multi-oras)
| # | Actiune | Trigger |
|---|---|---|
| 3.1 | Migrare completa curier la native canonic (foreground service, Play Integrity) | Reclamatii masurabile de tracking pierdut sau >30-50 curieri simultani |
| 3.2 | Dispatch ca serviciu separat | `pg_cron` 15s + RPC sincron devin bottleneck MASURAT |
| 3.3 | Device fingerprinting, KYC provider automat | Frauda la scara, nu la pool cunoscut |
| 3.4 | Surge pricing, heatmap cerere | Densitate suficienta de curieri/comenzi |

---

## 5. Ce spune industria (sinteza research, cu surse)

### 5.1 Dispatch/matching — DoorDash DeepRed, Uber Eats, Instacart
- **DoorDash DeepRed:** arhitectura pe 2 straturi — ML prediction (prep time, travel time, probabilitate acceptare) + optimization layer separat care rezolva matching la nivel de piata, nu greedy 1-la-1. Sursa: careersatdoordash.com/blog/using-ml-and-optimization-to-solve-doordashs-dispatch-problem/
- **Batching/rutare:** algoritm "ruin-and-recreate", paralelizat prin multithreading, pentru optimizarea rutei unui dasher cu comenzi batched. Sursa: doordash.engineering/2021/11/30/scaling-a-routing-algorithm-using-multithreading-and-ruin-and-recreate/
- **Politica de acceptance rate:** DoorDash NU deactiveaza pentru acceptance rate mic (contractori independenti au dreptul sa refuze); metrica cu consecinte e **Completion Rate**, prag 90% de la 7 martie 2024 (anterior 80%). Sursa: help.doordash.com/en-us/dashers/article/deactivation-policy-us-english-dx
- **Uber Eats:** Trip State Model bazat pe conditional random fields (CRF) peste semnale GPS+senzori, a inlocuit un algoritm Greedy local initial. Acceptance rate influenteaza doar statusul Uber Pro, nu deactivarea; cancellation rate e metrica de risc reala. Sursa: uber.com/blog/uber-eats-trip-optimization/
- **Instacart:** problema CVRPTW (Capacitated Vehicle Routing with Time Windows) descompusa in clustering + assignment separate; recompute o data pe minut, dispatching just-in-time. Sistem initial simplu: greedy pe deadline + cel mai apropiat shopper liber. Sursa: tech.instacart.com/space-time-and-groceries-a315925acf3a
- **Pattern comun (aplicabil direct la Chisinau, volum mic):** greedy simplu (sorteaza pe deadline, aloca curierul liber cel mai apropiat, verifica agregare pe drum) e suficient la scara mica — exact ce a folosit Instacart INAINTE sa scaleze la optimizare combinatoriala.

### 5.2 Mobile driver apps — offline-first, GPS in fundal, transparenta earnings
- **Offline-first e standard, nu opțional:** arhitectura tipica Android = Room (DB locala) + WorkManager (sync fundal) + Retrofit + Flow. Sursa: medium.com/@ahmed.ally2/offline-first-architecture-for-android-developers...
- **Android restrictioneaza tot mai agresiv fundalul:** Doze Mode poate reduce activitatea in idle profund cu pana la 92%; foreground service dedicat e obligatoriu pentru locatie in fundal pe Android 10+. Sursa: developer.android.com/develop/background-work/background-tasks/bg-work-restrictions
- **iOS:** Apple recomanda Significant-Change Location (bazat pe celule GSM) in loc de GPS continuu cand nu e nevoie de precizie constanta; standard de referinta: impact de baterie ~1-2%/24h pentru tracking all-day acceptabil. Sursa: developer.apple.com/library/archive/.../LocationBestPractices.html
- **react-native-background-geolocation** foloseste motion-detection intelligence pentru a reduce drenajul de baterie; case study a raportat -60% drenaj prin optimizare. Sursa: npmjs.com/package/react-native-background-geolocation
- **Bolt Food:** transparenta pe hartie (castig afisat inainte de acceptare) dar reviews predominant negative pe stabilitate app + notificari nesigure. Sursa: appgrooves.com/app/bolt-courier-by-bolt-technology-ou/negative
- **Wolt:** "City Heat Maps" + "Early Payouts" lansate direct din feedback curieri (2025); medie 2024: curierii Wolt in 20 tari UE au castigat ~235% din salariul minim national pe ora de livrare efectiva. Sursa: press.wolt.com/en-WW/257465-10-questions-about-wolt-couriers/
- **Glovo Rider:** dashboard cu grafice de castiguri zilnic/lunar/anual, tips 100% la curier. Sursa: play.google.com/store/apps/details?id=com.logistics.rider.glovo
- **Risc de transparenta algoritmica documentat academic:** raportul Human Rights Watch "The Gig Trap" (2025) arata opacitate algoritmica sistemica in platformele gig — motiv sa NU repeti tiparul (calculeaza plata cu formula fixa si vizibila, documentata public in app). Sursa: hrw.org/report/2025/05/12/the-gig-trap/algorithmic-wage-and-labor-exploitation-in-platform-work-in-the-us

### 5.3 Structura app-urilor si evolutia arhitecturii — Uber/DoorDash/Wolt/Glovo
- Toate 4 au **3+ app-uri client separate** (consumer/courier/merchant) — dar au inceput **monolit** si au migrat la microservicii DUPA probleme reale de crestere: Uber avea 2 servicii monolitice pana in 2012-2013 (a migrat apoi la DOMA, ~2200 microservicii pana in 2020, half-life 1.5 ani per serviciu); DoorDash a migrat de la monolit Python la microservicii in 2020 (strangler-fig pattern). Surse: uber.com/en-NL/blog/microservice-architecture/, careersatdoordash.com/blog/how-doordash-transitioned-from-a-monolith-to-microservices/
- **Stack realtime standard:** GPS ping periodic → Kafka → dedup → Redis (locatie curenta) → WebSocket push. Wolt Merchant app a avut o problema de latenta majora la scalare (30ms → 1.5 min cu 1 canal Redis Pub/Sub la 100% trafic), rezolvata prin multi-channeling (1→16→32 canale) — **lectie directa pentru Supabase Realtime**: verifica din timp ca subscriptiile nu sunt concentrate pe un singur canal fara filtrare per-destinatar. Sursa: careers.wolt.com/en/blog/tech/scaling-the-wolt-merchant-app-to-serve-30x-more-users
- **Lectii explicite Wolt pentru echipe mici:** observabilitate inainte de scalare, rollout gradual (feature-flag 10%→100%), async/event-driven > sincron secvential, **nu adauga read-replicas/caching preventiv**. Sursa: careers.wolt.com/en/blog/tech/prepare-for-scalability-events-at-wolt

### 5.4 Economia platformelor de delivery — comisioane, plata curieri, retentie (relevant Europa de Est)
- **Comisioane restaurante:** 20-30% norma industriei (Wolt/Glovo/DoorDash Basic 15%/Plus 25%/Premier 30%). Sursa: kitchencost.app/en/blog/delivery-platform-fees-guide-2026/
- **Plata curier Polonia** (piata comparabila): minim ~10-12 PLN/livrare; full-time = 8.000-10.000 PLN/luna; bonus ore de varf +30%, bonus meteo +25%. Sursa: avalon-logistics.pl/en/news/glovo-earnings-2025-how-much-does-a-glovo-courier-earn/
- **Quest-uri Uber Eats/Foodpanda:** target de livrari intr-o fereastra fixa → bonus fix (ex. Japonia: ~3.500 yen la 30 livrari, ~17.000 yen la 90 livrari/4 zile). Sursa: therideshareguy.com/the-best-strategies-and-hacks-for-uber-quest/
- **Retentie e problema #1 a industriei:** turnover anual soferi delivery SUA ~90% (2023); Amazon ~50% pleaca in primele 90 zile; cost de inlocuire per curier estimat 3.000-7.000$. Sursa: netchex.com/blog/turnover-among-delivery-drivers-industry-data-and-what-route-businesses-can-do/
- **Directiva UE Platform Work:** risca sa infleze costul de munca al curierilor cu pana la 30% (Moldova nu e in UE, dar presiune regionala posibila). Sursa: deliveryplatforms.eu (Copenhagen Economics study)
- **Piata Chisinau azi:** Glovo si Wolt/Bolt Food sunt lideri; Wolt are retea de restaurante mai groasa; jucatori locali mici (Straus.md, FoodHouse) activi. Sursa: nomada.tools/directory/food-delivery/moldova, sitecatalog.md/en/best-delivery-services-in-chisinau/

---

## 6. Riscuri majore consolidate + mitigari

| Risc | Severitate reala (recalibrata) | Mitigare | Cost |
|---|---|---|---|
| Documentatie/cod drift (GPS "known issue" stale) | Joasa (fix deja livrat) | Sincronizeaza `CLAUDE.md`; adauga in verifier un pas care compara migratii aplicate cu lista de known-issues | Mic |
| `/enter/[role]` demo doorway in productie | Medie (igiena, nu breach — RLS e granita reala) | Elimina/feature-flag hard inainte de trafic real | Mic |
| Coordonate restaurant demo | Ridicata (blocheaza orice validare) | Geocodare reala inainte de launch | Mic-mediu |
| Lipsa shared-types web↔Expo | Ridicata pe termen mediu (schema drift silentios) | Monorepo workspace cu tipuri generate din schema Supabase | Mediu |
| Push nativ absent pe Expo (Web Push pe web exista deja) | Medie (nu critica la pool mic) | Verifica E2E Web Push existent; FCM/APNs cand volumul o cere | Mic→Mediu |
| Lipsa batching | Medie, NU critica la volum curent | Batching manual/opt-in ca prim pas | Mic |
| Zero payment gateway real | Medie in contextul Moldova (COD viabil la volum mic) | PSP local (maib/Paynet) cand volumul/disputele cresc | Mare (integrare PSP) |
| Lipsa offline queue mobil | Medie (recuperabil manual la volum mic) | Coada locala (IndexedDB/SQLite) + retry idempotent | Mediu |
| Lipsa suport & siguranta (SOS) | Ridicata ca risc legal/reputational, cost mic de fix | Buton SOS + escaladare admin simpla (nu call-center <2min) | Mic |
| Anti-frauda single-signal (doar viteza GPS) | Joasa la pool mic/verificat manual | Extinde cu no-show rate, geofence soft-flag (NU hard-block — GPS drift urban) | Mediu |
| Scoring dispatch hardcodat in SQL | Joasa la volum mic | Externalizeaza in tabel de config cand ai date sa tunezi | Mic |
| Load/concurenta netestata sub trafic real | Ridicata inainte de launch public | Test de accept-race + load 50-100 comenzi/ora | Mediu |

---

## 7. Top 10 actiuni concrete, ordonate dupa impact

1. **Sincronizeaza `CLAUDE.md`/known-issues cu codul real** — GPS e deja fixat; verifica si alte "known issues" pentru drift similar. Cost minim, previne raspuns gresit la risc fantoma.
2. **Scoate `/enter/[role]` din build de productie** — igiena pre-launch, cost minim.
3. **Populeaza coordonate reale de restaurant** (geocodare) — blocant pentru orice validare de dispatch/ETA/PostGIS.
4. **Construieste pachetul de tipuri/client API partajat** (monorepo workspace Next.js↔Expo) — cel mai ieftin fix cu impact pe termen lung, necontestat de nicio lentila.
5. **Verifica E2E si activeaza Web Push-ul deja implementat** (outbox → `/api/push/drain` → `sw.js`) pentru ofertele de dispatch — corectie fata de dezbatere: codul exista deja; ramane opt-in-ul curierilor + testul E2E; FCM/APNs abia cand volumul o cere.
6. **Adauga coada offline minima** (IndexedDB pe web / SQLite pe Expo) pentru evenimente de status/GPS in gap-uri de semnal.
7. **Earnings breakdown per livrare + buton SOS simplu** — incredere si siguranta cu cost mic, foloseste `payout_lock` si notification outbox existente.
8. **Construieste dashboard minim de metrici operationale** (acceptance rate, time-to-assign, on-time rate) — necesar INAINTE de orice decizie de batching/extractie de platforma.
9. **Batching manual/opt-in** ca prim pas — valideaza UX cu curieri reali inainte de a investi in scoring automat.
10. **Test de concurenta (accept-race pe oferta) + load test dispatch la 50-100 comenzi/ora** — inainte de lansare publica, ca sa validezi pe trafic real ce e azi validat doar pe cod/arhitectura.

---

## 8. Anexa — cum sa folosesti acest raport intr-un simulator + scraper

### 8.1 Parametri de simulat (dispatch/economie)

| Parametru | Interval realist Chisinau (start) | Interval la scala | Sursa/ancora |
|---|---|---|---|
| Cerere/ora (comenzi) | 5-20/ora in varf | 50-100+/ora | volum estimat piata 500k locuitori |
| Curieri activi simultan | 10-50 | 200-500 | — |
| Fereastra oferta dispatch | 30s countdown | idem | cod existent |
| Cascada max waves | 5 | idem | cod existent |
| Sweeper interval | 15s (pg_cron) | — | cod existent |
| Viteza curier per vehicul | bike=12km/h, scooter=25km/h (constante din cod) | — | cod existent |
| Acceptance rate — fereastra penalizare | 14 zile | — | cod existent |
| Completion rate — prag deactivare (referinta industrie) | 90% (DoorDash, de la 03/2024; anterior 80%) | — | help.doordash.com |
| Batching — raza compatibilitate | 300-500m intre pickup-uri | — | consolidat din pozitii |
| Comision platforma pe restaurant | test 10-15% (diferentiator) vs 20-30% (norma) | — | kitchencost.app |
| Cost per livrare fara batching | ~8-10 (echivalent) | cu batching: ~4-6 | revenuemap.app/kitchencost.app |
| Turnover curier anual | 40-90% (referinta industrie) | — | netchex.com |
| Cost inlocuire per curier | 3.000-7.000$ (referinta SUA, ajusteaza pentru Moldova) | — | netchex.com |
| ETA eroare haversine vs ruta reala | 10-20% (estimare ajustata, nu 30-50%) | — | rezultat dezbatere, contestat si recalibrat |

Ce sa simuleze scriptul concret:
- Genereaza N comenzi/ora dupa distributie Poisson cu rata variabila pe ora (peak lunch 12-15, peak dinner 18-21).
- Simuleaza pool de M curieri cu stare online/busy/offline si heartbeat.
- Ruleaza dispatch greedy (scoring haversine ETA + penalizare acceptance) cu fereastra 30s + cascada 5 waves + sweeper 15s — reproduce exact logica din cod.
- Testeaza cu si fara batching (raza 300-500m, compatibilitate temporala) — masoara delta cost-per-livrare si utilizare curier.
- Injecteaza rata de refuz/acceptance variabila (50-95%) ca sa vezi la ce prag cascada ajunge la wave 5 fara candidat (gap de escaladare identificat in dezbatere).
- Masoara timp-mediu-oferta-la-accept, time-to-assign, drop-off rate per wave — exact metricile cerute in sectiunea 4 (FAZA 1.5).

### 8.2 Ce sa caute scraperul

**Comparatii pret/fee (concurenta directa Moldova):**
- Glovo Moldova (glovoapp.com/en/md/chisinau) — structura comision restaurant, fee client
- Wolt Moldova, Bolt Food Moldova — acelasi
- Straus.md, FoodHouse — feature-set, arie de acoperire, ce lipseste (gap de piata pentru diferentiere)

**API-uri publice de referinta:**
- Uber Eats Marketplace API (developer.uber.com) — model de integrare merchant
- DoorDash Developer docs, `dasher_status_webhooks` — model de webhook status curier
- Google Directions API / Mapbox Directions API — pricing per-request, pentru decizia rutare reala (Faza 2.6)

**Solutii open-source de evaluat:**
- OSRM (Open Source Routing Machine) — self-hosted routing, alternativa la cost 0 licenta la Mapbox/Google
- `react-native-background-geolocation` (Transistor Software) / Radar.io — pentru migrarea Faza 3 la native canonic
- pgTAP — testare automata RLS (gap identificat: "RLS solid" e afirmatie arhitecturala fara suite de teste citat explicit)
- Supabase Realtime docs — praguri de conexiuni concurente per tier, relevant pentru decizia Faza 3.2

**Reglementare de monitorizat (context, nu blocant imediat):**
- Platform Work Directive UE — presiune regionala indirecta asupra costului de munca al curierilor (Moldova nu e in UE, dar Romania/Polonia sunt)

---

*Raport compilat din 7 pozitii de expert + 7 seturi de refutari + 4 topicuri de research cu surse verificate + 3 verificari directe in codul repo-ului `chisinau-delivery` facute pentru acest document.*
