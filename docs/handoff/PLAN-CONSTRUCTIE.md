# PLAN DE CONSTRUCȚIE — Dragons Delivery = paritate Bolt Food, construit pe 4 terminale

> 2026-10-11. Sursa: `replica/plan-paritate.md` (W1–W7, dezbatere 3 modele + red-team), `replica/gap-map.csv` (157 funcții Bolt vs cod), handoff-urile din acest folder.
> „100% Bolt” = aceleași fluxuri și aceeași experiență pe cele 3 aplicații + panoul de operare, construite **clean-room** (zero cod/text/imagini Bolt; brand Dragons). Rețeaua Bolt, Bolt Plus, cross-sell ride și grocery sunt în afara scopului (`skip`).

## 0. Unde suntem (gap-map, funcții `yes` din relevante)
| sector | terminal | gata | % |
|---|---|---|---|
| Client | CLIENT (sesiunea de origine) | 24/63 | 38% |
| Curier | CURIER | 5/29 | 17% |
| Restaurant | RESTAURANT | 8/36 | 22% |
| Admin / platformă | ADMIN | 3/17 | 18% |

Procentele cresc doar când rândul din `replica/features.csv` trece `clone=yes` **cu dovadă** (test/sim/captură). Fiecare terminal își actualizează rândurile lui la commit.

## 1. Principiul de ordine (același în toate terminalele)
1. **Operabil înainte de frumos**: o comandă reală trebuie să treacă cap-coadă (client → restaurant → curier → bani) înainte de orice funcție de confort.
2. **Must → should → could** din gap-map. Nimic `could` până nu sunt toate `must`-urile sectorului verzi.
3. **Contract înainte de UI** la orice punct de sincronizare (secțiunea 3): proprietarul datelor livrează migrația + sim-ul, consumatorul construiește UI-ul peste ele.
4. Fiecare etapă se închide cu: teste care picau înainte, `npm run verify`, `npm run test:rpc`, dovadă în realitate (browser/telefon), commit, rândurile din `features.csv` actualizate.

## 2. Etapele pe sector
### CLIENT — `mobile/client` (Expo Go acum, nativ după EAS) + web `(customer)`
- **C1 Adresă livrabilă** (W2): pin obligatoriu pe hartă (MapView trăgabil) + scară/etaj/interfon (coloanele există) + raza de livrare a restaurantului verificată în `place_order` și pe Home (doar restaurantele care livrează la adresa aleasă). **Web checkout primește același pin** (altfel `place_order` îl rupe — critic #3). *Gata când*: sim care refuză adresa fără pin/în afara razei + comandă de pe telefon cu pin real.
- **C2 Meniu ca Bolt**: „Epuizat” gri (după RESTAURANT R2), notă per produs (`order_items.notes`, azi nescrisă de `place_order`), căutare în meniu, editarea unei linii din coș.
- **C3 Cont și încredere**: ștergere cont (`delete_my_account` peste `erase_customer_pii`), contact suport din config, ecran de ajutor/raportare problemă pe comandă (consumă ADMIN A2).
- **C4 Discovery generalist**: categorii reale de bucătărie (azi doar Sushi/Fine Dining/Catering hardcodate), filtre preț/reduceri, carduri cu ETA real.
- **C5 Bani la client** (după ADMIN A4 + contract maib): coduri promo aplicate pe server, plată card online, ridicare personală.
- **C6 RU + design system mobil** (spațieri, rază, fonturi), safe-area și ținte de 44 pt.

### CURIER — `mobile/driver` + web `(courier)`
- **K1 Pe telefon** ✅ upgrade Expo 57 (`c9273d9`) → rulare în Expo Go pe :8083 (foreground) → `eas init` + APK dev client pentru GPS în fundal.
- **K2 Oferta ca Bolt**: `offer_preview` (sector livrare, km totali, km până la restaurant, câștig) doar pentru curierul cu oferta vie; timerul ofertei din config (30 s vs 45–60 s = decizia userului).
- **K3 Livrarea cap-coadă**: foto la livrare (`attach_delivery_proof`), probleme raportate (întârziere, nu găsesc localul, client de negăsit) → `delivery_status_events` + coada ADMIN.
- **K4 Banii curierului**: gaura de 6 km la adrese fără pin (după CLIENT C1), depunere cash (`record_cash_offload`), istoric câștiguri cu bacșiș, IBAN în profil (pentru ADMIN A1).
- **K5 Înscriere în aplicație**: KYC + vehicul + documente direct din driver (azi doar web), suport, profil fără rânduri moarte; heartbeat și pe web-ul curierului.

### RESTAURANT — panoul partenerului (:3003) + tableta de bucătărie
- **R1 Tableta nu ratează nimic** ✅ sunet + wake lock (`7daa974`) → refuz cu motiv, **busy mode** +15/30/45 (în lucru, sim 200), istoric, bon tipărit.
- **R2 Meniu operabil**: „Epuizat azi” cu coloană separată + gardă în `place_order` (cerere spre CLIENT), import de meniu în masă, timetable pe secțiuni.
- **R3 Comanda la ridicare**: cardul curierului (prenume + hartă; telefon doar dacă userul decide), ETA-ul curierului la restaurant.
- **R4 Bani și rapoarte**: câștiguri săptămânale CSV, IBAN restaurant (pentru ADMIN A1), analytics pe ore/produse (există parțial).
- **R5 Onboarding restaurant**: checklist tabletă (PWA, kiosk, sunet), date reale (coordonate, program, poze cu drepturi).

### ADMIN — panoul platformei (:3004)
- **A1 Plăți care chiar plătesc** (în lucru: migrația `0401`, sim 250): payouts din cron fără JWT, idempotente, săptămâna în Europe/Chisinau cu DST, CSV pentru bancă (formatul băncii = userul).
- **A2 Suport pilot**: jurnal de reclamații pe comandă, ajustare/rambursare parțială (sim pe bani), cut-off configurabil pentru comenzile fără curier + push la client.
- **A3 Alerte cu mecanism**: `pending_restaurant` neacceptat, `dispatch_errors` noi, outbox blocat → webhook (canalul = userul).
- **A4 Config comercial**: coduri promo (tabel + reguli, aplicate de CLIENT în `place_order`), taxe de serviciu/comandă mică versionate.
- **A5 Pregătire lansare**: scoaterea ușilor de dev (`/enter`, `/master`, autologin), review RLS, login pentru curierul aprobat (critic #7).

## 3. Puncte de sincronizare (cine livrează contractul → cine consumă)
| # | ce | livrează întâi | consumă după | stare |
|---|---|---|---|---|
| S1 | „Epuizat” (coloană + gardă) | RESTAURANT (migrație + UI partener) | CLIENT (gardă `place_order`, randare) | cerut în CROSS-REQUESTS |
| S2 | Busy mode → ETA | RESTAURANT (`estimated_ready_at`) | CLIENT (ETA pe card/tracking), CURIER (momentul ofertei) | în lucru (sim 200) |
| S3 | Pin + rază | CLIENT (`place_order`, UI) | CURIER (tariful fără fallback de 6 km) | de făcut C1 |
| S4 | IBAN | CURIER + RESTAURANT (câmpuri + validare MD) | ADMIN (CSV payouts) | A1 în lucru |
| S5 | Reclamații/rambursări | ADMIN (tabel + RPC) | CLIENT (ecran ajutor), CURIER (raportare problemă) | de făcut A2 |
| S6 | Promo/taxe | ADMIN (config versionat) | CLIENT (checkout) | de făcut A4 |
| S7 | Push nativ (FCM/APNs) | userul (Firebase + Apple) → CLIENT/CURIER | toți | blocat pe conturi |
| S8 | Plată card online | userul (contract maib/PayNet) → ADMIN + CLIENT | toți | blocat pe contract |

Fiecare punct S se cere și se închide prin `docs/handoff/CROSS-REQUESTS.md` („→ făcut <sha>”).

## 4. Ce ține DOAR de user (fără ele nu e „100% operațional”, oricât cod)
Contract plăți online (maib/PayNet) · Apple Developer (99 USD/an) pentru iPhone nativ · proiect Firebase pentru push Android · proiect Supabase de staging/prod NOU (nu cel partajat Trade-AI) · firmă (IDNO) + regim fiscal curieri decis cu contabil · 3–5 restaurante semnate + 5–10 curieri pentru pilot · domeniu + host web · avocat pe termeni/confidențialitate. Lista completă, legată de etape: `replica/plan-paritate.md` → „Acțiuni care țin doar de owner”.

## 5. Definiția „gata” pentru tot ecosistemul (pilotul)
O comandă plasată de pe telefon cu pin real → tableta sună → restaurantul acceptă și marchează gata → curierul primește oferta cu preview, navighează, livrează cu poză → clientul urmărește live și dă rating → plata (cash/POS, apoi card) intră în ledger → payout săptămânal în CSV → orice blocaj apare în coada ADMIN în minute. Dovada: `npm run test:e2e` extins cu fluxul ăsta + o comandă reală pe 2 telefoane.
