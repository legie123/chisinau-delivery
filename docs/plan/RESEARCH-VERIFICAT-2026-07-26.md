# Research verificat adversarial — Platformă de curierat (2026-07-26)

**Metodă:** deep-research harness — 5 unghiuri de căutare → 23 surse citite integral → 108 claim-uri falsificabile extrase → verificare adversarială cu 3 voturi per claim (2/3 refuzuri = eliminat) → 25 confirmate → 13 findings după dedup semantic. 105 agenți, 0 erori.
**Regulă de citire:** tot ce e mai jos a supraviețuit verificării. Ce NU e aici nu e infirmat — pur și simplu nu a fost confirmat (vezi §4, țintele scraperului).

Documente-pereche: `RAPORT-DEBATE-CURIERAT-2026-07-26.md` (dezbaterea multi-expert) și `CORE-CURIERI.md` (planul canonic al platformei de curieri).

---

## 1. Arhitectură — verdictul industriei (confirmă verdictul dezbaterii)

### F1. O platformă, trei suprafețe — nu trei platforme. Monolit la start. `[3-0, ×3 surse merged]`
DoorDash a pornit (2013) ca UN monolit Django pe UN singur PostgreSQL, servind clienți + restaurante + Dasheri, și a dus întregul marketplace 3-sided pe el ~6 ANI. Chiar și după migrarea la microservicii, arhitectura-țintă rămâne UN backend partajat cu frontend-uri per-rol (consumer / merchant / Dasher) decuplate prin BFF-uri. Primul serviciu care a justificat extragerea: **dispatch-ul** (Deep Red, 2014, rescris în Scala pentru că Python nu ducea calculul CPU-intensiv) — semnal direct unde va apărea prima presiune arhitecturală și la Chișinău.
Sursă: careersatdoordash.com/blog/how-doordash-transitioned-from-a-monolith-to-microservices/ (verificat prin Wayback după 403 Cloudflare)

### F2. Dispatch = un singur proces cu lock per-oraș, la scara ta. `[3-0, ×2]`
Jarvis (dispatch-ul Glovo) a rulat inițial pe O SINGURĂ mașină, cu modelul actor: exact un actor per oraș. Proprietatea de corectitudine: două procese nu au voie să dispecerizeze același oraș simultan (asignări conflictuale). Pentru lansarea într-un singur oraș (Chișinău): dispatch-ul poate fi literal un proces cu un lock per-oraș — toată problema de sisteme distribuite se amână până la multi-oraș.
Sursă: medium.com/glovo-engineering/migrating-glovos-dispatching-service-from-a-single-machine-to-a-distributed-system-863cf6388fdd

---

## 2. Dispatch — cum funcționează în producție la cei mari

### F3. Optimizare GLOBALĂ combinatorică, niciodată greedy nearest-courier. `[3-0, ×3]`
Glovo evaluează toate combinațiile comenzi × curieri și rezolvă cu algoritm Ungar, Minimum Cost Flow și MIP, alimentate de estimări ML (timp sosire curier, timp preparare). DoorDash: MIP cu funcție obiectiv + constrângeri rafinate continuu (solver comercial Gurobi). Ambele resping explicit „cel mai apropiat curier liber". Un paper arXiv 2026 (2606.13604) confirmă că optimizatorul combinatoric rămâne nucleul în producție la DoorDash, RL doar ajustează ponderile obiectivului.
Surse: cele două articole Glovo Medium + careersatdoordash.com/blog/optimizing-real-time-algorithms-experimentation/

### F4. Cadență: buclă de asignare ~10s, buclă de bundling ~60s. `[3-0]`
Glovo comite decizii de asignare per oraș cel mult la fiecare ~10 secunde (matrice până la ~1k×2k ≈ 2M combinații per fereastră în orașe mari); generarea de bundle-uri multi-comandă (VRP, mai grea) rulează pe fereastră relaxată de ~1 minut. Parametri de tick direct transplantabili în motorul de Chișinău. (Caveat minor: dimensiunile 1k vs 2k pot fi inversate față de sursă.)
Sursă: medium.com/glovo-engineering/inside-glovos-deliveries-optimization-7609f3f86586

### F5. Batching/stacking = decizie de optimizare pe 3 niveluri, nu afterthought. `[3-0, ×2]`
Glovo: (1) simple bundling — 2 comenzi, același pickup; (2) cross-location bundling — pickup-uri diferite; (3) multibundling — N comenzi, NP-hard VRP, calculat ASINCRON de un generator separat care scrie candidați în Redis. DoorDash (DeepRed): bonus în obiectiv pentru batch-uri care adaugă eficiență, penalizare pentru întârziere excesivă, penalizare de varianță proporțională cu complexitatea rutei, și **întârziere deliberată a dispatch-ului** ca să aștepte un Dasher mai bun sau să alinieze sosirea cu food-ready.
Surse: articolul Glovo optimization + careersatdoordash.com/blog/using-ml-and-optimization-to-solve-doordashs-dispatch-problem/

### F6. DeepRed = arhitectură de referință în 2 straturi. `[3-0, ×2]`
(1) Strat ML cu estimări per-ofertă: order-ready-time (model de prep antrenat pe date cenzurate), travel time descompus în sub-modele separate (segmente de condus, parcare la restaurant/client, pickup handling, întoarcere la vehicul), probabilitate de acceptare per-Dasher. (2) MIP marketplace-wide care consumă estimările și emite recomandările finale de ofertă (Gurobi).
Sursă: careersatdoordash.com/blog/using-ml-and-optimization-to-solve-doordashs-dispatch-problem/

### F7. Contractul cu curierul = offer/accept cu cascadă de decline — mecanica #1 de replicat. `[3-0, ×2]`
DoorDash alege Dasher-ul cel mai potrivit (folosind probabilitatea prezisă de acceptare ca să țintească ofertele), Dasher-ul poate refuza (contractor independent), la refuz sistemul re-oferă următorului protejând on-time delivery. Asignarea forțată nu există la nicio platformă mare verificată. → App-ul nostru are deja exact modelul ăsta (dispatch_offers, 30s, cascade) — direcție confirmată de industrie.
Surse: cele două articole DoorDash de mai sus

### F8. Nicio decizie de dispatch nu e finală — proiectează pentru reasignare din ziua 1. `[3-0]`
Orice comandă poate fi reasignată și reintră în ciclurile următoare de optimizare (telefonul curierului moare, pană, client anulează). State machine-ul comenzii + bucla de dispatch trebuie să suporte reasignarea nativ.
Sursă: articolul Glovo optimization

### F9. Problema centrală de TIMING: sincronizarea sosirii curierului cu food-ready. `[3-0]`
Dispatch prea devreme = curierul așteaptă la restaurant; prea târziu = mâncarea se degradează. Uber Eats o rezolvă cu timing ML pe stările călătoriei (curierul ajunge exact când mâncarea e gata) — prep-time estimation e model de primă clasă, nu constantă statică per restaurant. → WS4 (restaurant_prep_stats) din app e direcția corectă; următorul pas natural e bucketing mai fin + feedback loop.
Sursă: uber.com/blog/uber-eats-trip-optimization/

### F10. GPS brut nu ajunge în centru urban dens — sensor fusion. `[3-0]`
Uber Eats fuzionează GPS cu accelerometru/giroscop și Android ActivityRecognitionClient ca să infereze ce face curierul (merge pe jos vs conduce, la restaurant vs en route). Planifică inferență de stare cu senzori, nu doar GPS — relevant pentru centrul Chișinăului. (Caveat: sursa e snapshot 2018.)
Sursă: uber.com/blog/uber-eats-trip-optimization/

---

## 3. Simulatorul — exact ce vrei să construiești, validat de industrie

### F11. Simulator pre-lansare = practică dovedită, ieftină, replicabilă direct: SimPy DES. `[3-0, ×3]`
Glovo și-a construit simulatorul de platformă ca Discrete Event Simulation pe **SimPy** (Python, MIT, open-source; ales pentru că event-driven sare peste timpii morți → rapid), modelând 3 tipuri de entități: **curieri** (lifecycle: start tură la locație → deplasare la pickup → așteptare prep → livrare), **comenzi**, și **motorul de dispatch**. Îl folosesc ca să testeze schimbări de algoritm de asignare și să calibreze parametri înainte de rollout, inclusiv identificarea driver-elor timpilor de livrare. → Stack-ul concret pentru simulatorul tău de Chișinău: SimPy + exact această descompunere pe entități + parametrii din CORE-CURIERI §12.
Sursă: medium.com/glovo-engineering/how-to-simulate-a-global-delivery-platform-7aa5fa475d88

### F12. A/B naiv pe dispatch e structural nefiabil — simulare offline, apoi switchback. `[3-0, ×3]`
Efecte de rețea de marketplace: asignezi un curier în grupul de test → l-ai scos din supply-ul grupului de control. Pattern-ul industriei: (1) simulare offline întâi — comprimă săptămâni de experimente în ore/minute, imită comportamentul consumer/curier/merchant sub condiții contrafactuale de supply-demand; (2) experimente **switchback** — randomizezi control vs treatment pe ferestre de timp disjuncte (chiar și câteva ore) încrucișate cu regiuni geografice, ~2 săptămâni de date per experiment. Comparația pre/post e nefiabilă sub supply/demand volatil.
Surse: articolul Glovo simulator + cele două articole DoorDash

### F13. Temperează așteptările simulatorului. `[2-1 — medium]`
DoorDash a constatat că un simulator OFFLINE PRECIS pentru dispatch în timp real e cam la fel de greu ca problema de dispatch însăși (fiecare decizie de asignare afectează starea viitoare); de-asta iterează în principal prin switchback în producție, iar simulatorul lor mai nou țintește explicit „directional accuracy without high precision". → Folosește simulatorul SimPy pentru tuning DIRECȚIONAL (mărime flotă, praguri de batching, timeout oferte), și tratează datele de producție ca ground truth după lansare.
Sursă: careersatdoordash.com/blog/optimizing-real-time-algorithms-experimentation/

---

## 4. Ce NU a supraviețuit verificării — țintele scraperului

Cel mai mare caveat al întregului research: din cele 5 arii cerute, claim-uri verificate au supraviețuit DOAR pe (a) arhitectură, (b) algoritmi dispatch + GPS sensor-fusion, (e) simulatoare. **Zero claim-uri confirmate** pe:

1. **Modele de plată curieri** (per drop / per km / garanții orare) și sisteme de incentive/quest/retenție — Glovo și Bolt Food operează în Moldova/România, deci datele există; scraperul trebuie să le vâneze din surse primare (T&C curieri, forumuri de curieri RO/MD, grupuri Telegram/Facebook, anunțuri de recrutare cu tarife).
2. **Unit economics la scara Chișinău 2024-2026** — comisioane reale restaurante, cost per livrare, AOV în MDL, pragul de densitate de comenzi pentru break-even. Necesită date primare: financiare de operatori locali, dezvăluiri regionale Glovo/Bolt.
3. **Vectori de fraudă și detecții** — nimic confirmat prin procesul de 3 voturi (dezbaterea multi-expert acoperă parțial, dar fără surse externe verificate).
4. **Validarea stack-ului open-source** — care motor de rutare (OSRM vs Valhalla vs GraphHopper) + H3/PostGIS e dovedit în producție pentru flote mici; există vreo platformă open-source de dispatch/fleet sau white-label care înlocuiește credibil un Jarvis/DeepRed-lite? Nimic confirmat.
5. **Întrebarea de aur pentru simulator** (formulată chiar de verificatori): optimizarea globală MIP-style chiar bate un dispatcher greedy/cascade simplu la scara Chișinău (zeci de curieri, nu mii), sau e over-engineering sub un anumit prag de densitate? — **Răspunde-i exact cu simulatorul SimPy din F11.**

## 5. Caveats generale

- Aproape toate findings = engineering blogs first-party (DoorDash/Glovo/Uber) — candide tehnic, dar companii la 100-1000× scara Chișinăului; aplicabilitatea ferestrei de 10s sau a MIP-ului Gurobi-class la ~500k locuitori e inferență, nu claim verificat.
- Surse 2018-2023; arhitecturile DoorDash/Glovo coroborate ca actuale până în 2026 (arXiv 2606.13604, pagini live), dar sensor-fusion-ul Uber Eats e snapshot 2018, iar ponderile statice DoorDash sunt în curs de înlocuire cu ponderi adaptate prin RL.
- Câteva URL-uri DoorDash sunt după Cloudflare 403 — verificate prin Wayback; eng.uber.com a migrat la uber.com/blog.
- „Agent-based" e eticheta verificatorilor pentru entitățile DES ale Glovo — nu termenul companiilor.

## 6. Statistici proces

| Metric | Valoare |
|---|---|
| Unghiuri de căutare | 5 |
| Surse citite integral | 23 |
| Claim-uri extrase | 108 |
| Claim-uri intrate la verificare | 25 |
| Confirmate / ucise / neverificate | 25 / 0 / 0 |
| Findings finale după dedup | 13 (12 high, 1 medium) |
| Agenți / tool uses | 105 / 735 |
