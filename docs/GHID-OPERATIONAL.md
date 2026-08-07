# Ghid Operațional — Chișinău Delivery (Dragons Delivery)

> Runbook practic: cum duci aplicația LIVE pentru restaurante reale, cum onboardezi
> un restaurant, cum o operezi zilnic, ce faci când ceva se blochează.
> Actualizat: 2026-08-07.

---

## 0. TL;DR — de ce nu e „operațională" acum și ce lipsește

Aplicația **funcționează complet la nivel de cod** (comenzi, dispatch, curieri, cash,
payout, onboarding — toate probate end-to-end, 52 teste RPC + 56 unit verzi). Ce
lipsește ca s-o poți recomanda unui restaurant real sunt **3 lucruri de infrastructură**,
nu de cod:

1. **Backend-ul live e OPRIT.** Proiectul Supabase `rdowjxnuyawhrjppxzuu` ("TRade-AI-GO")
   e `INACTIVE` (pauzat) și e împărțit cu Trade-AI. Un restaurant nu poate folosi ceva ce
   se conectează la un backend pauzat. → **Secțiunea 2**.
2. **Aplicația nu e deployată nicăieri.** Rulează doar pe laptopul tău (`localhost:3000`).
   Nu există remote git, nu există config de deploy. → **Secțiunea 3**.
3. **Datele sunt demo** (restaurante fictive, coordonate demo). Restaurantul real se
   onboardează prin fluxul din **Secțiunea 4**.

Restul (funcționalitatea) e solid. Acest ghid te duce de la „merge pe laptop" la „un
restaurant real primește și livrează comenzi".

---

## 1. Ce este aplicația (30 secunde)

Platformă de food-delivery pentru Chișinău (sushi/fine-dining + catering), MDL, UI în
română. **Un singur backend Supabase** (Postgres + RLS + Realtime + Auth + Storage) și
**4 suprafețe pe roluri** în același Next.js:

| Suprafață | Rol | Ce face |
|---|---|---|
| `(customer)` `/restaurants` | Client | Browse, comandă, tracking |
| `(admin)` `/restaurant/*` | Partener restaurant | Primește comenzi, meniu, ore, câștiguri |
| `(courier)` `/deliveries` | Curier | Oferte, livrare, cash, câștiguri |
| `(admin)` `/platform/*` | Admin platformă | Centru operațional, payout, moderare |

Securitatea reală = **RLS în Postgres** (nu proxy-ul UI). Orice schimbare de stare a unei
comenzi trece prin RPC-uri `security definer` — clientul nu poate scrie stări direct.

---

## 2. GO-LIVE pas 1 — Backend-ul live

**Decizie de luat (recomandarea mea):** NU folosi proiectul pauzat "TRade-AI-GO". E pe
plan free (se pauzează după inactivitate — inacceptabil pentru un pilot real) și e
împărțit cu tabelele Trade-AI. Pentru un pilot cu restaurante reale:

**Opțiunea A (RECOMANDAT) — proiect Supabase dedicat, pe plan plătit:**
1. Creează un proiect nou în dashboard.supabase.com (regiune `eu-central` sau `eu-west`),
   pe **Pro** ($25/lună) ca să NU se pauzeze.
2. Ia `Project URL` + `anon key` + `service_role key` din Settings → API.
3. Leagă local și aplică TOATE migrațiile (NU seed-urile — alea sunt date demo):
   ```bash
   supabase link --project-ref <ref-nou>
   supabase db push            # aplică cele 83 de migrații din supabase/migrations/
   ```
4. Activează extensiile pe proiectul nou (dacă `db push` nu le-a activat): `postgis`,
   `pg_cron`, `pg_net` (Database → Extensions). Migrațiile presupun toate trei.
5. **NU rula seed-urile în prod.** Restaurantele reale se creează prin onboarding (§4).

**Opțiunea B (rapid, dar fragil) — repornește proiectul pauzat:**
- Restaurează `rdowjxnuyawhrjppxzuu` din dashboard, apoi `supabase db push`. Riscul de
  pauzare rămâne + coabitezi cu Trade-AI (NU atinge tabelele `poly_*`, `polymarket_*`,
  `gladiator*`, `equity_history`, `syndicate_audits`).

**Verificare backend live după push:**
```bash
supabase migration list        # local == remote, zero diferență
# în SQL editor pe proiectul live:
select jobname, active from cron.job;   # trebuie 8 joburi active
```

**IMPORTANT — jobul de push notifications:** cron-ul `drain-push-outbox` face `net.http_post`
către URL-ul aplicației. Local e `localhost:3000/api/push/drain`. În prod trebuie
repointat pe URL-ul deployat (vezi §3) — altfel notificările nu pleacă. Se schimbă
prin re-scheduling jobului cu URL-ul nou + `PUSH_DRAIN_SECRET`-ul de producție.

---

## 3. GO-LIVE pas 2 — Deploy aplicația

Next.js 16 SSR → cel mai simplu pe **Vercel**.

1. **Push repo pe GitHub** (nu există remote acum):
   ```bash
   gh repo create chisinau-delivery --private --source . --push
   ```
2. **Importă în Vercel** (vercel.com → New Project → repo-ul). Framework auto-detect Next.js.
3. **Setează variabilele de mediu** în Vercel (Settings → Environment Variables), Production:

   | Variabilă | Valoare | Note |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL-ul proiectului live | din §2 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key live | din §2 |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key live | activează invite admin din UI |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | cheie VAPID publică | `npx web-push generate-vapid-keys` |
   | `VAPID_PRIVATE_KEY` | cheie VAPID privată | idem |
   | `VAPID_SUBJECT` | `mailto:tu@domeniu.md` | pt push |
   | `PUSH_DRAIN_SECRET` | secret random tare | trebuie == cel din jobul cron drain |
   | `NEXT_PUBLIC_OSRM_URL` / `OSRM_URL` | URL OSRM sau gol | gol ⇒ fallback haversine |
   | `NEXT_PUBLIC_ENABLE_ONLINE_PAYMENT` | `false` | plata online e mock; ține COD |
   | `ENABLE_MASTER_DOORWAY` | **nesetat/false** | doorway-ul cu parolă rămâne OFF |

   NU seta `MASTER_DOORWAY_*` în prod.
4. **Deploy.** Vercel forțează `NODE_ENV=production` → `/enter/[role]` (doorway demo fără
   parolă) redirectează automat la `/login`. Bine.
5. **Domeniu:** leagă un domeniu real (ex. `comanda.numele-tau.md`) în Vercel.

**Post-deploy — checklist de securitate lansare:**
- [ ] `/enter/[role]` redirectează la `/login` pe domeniul de prod (nu e passwordless).
- [ ] Repointează cron `drain-push-outbox` pe `https://<domeniu>/api/push/drain`.
- [ ] Creează primul cont admin real (vezi §4.0) și șterge conturile `*@test.md` de test.
- [ ] Push funcționează cu cheile VAPID reale (testează cu un curier real pe Chrome Android).

---

## 4. Onboarding un RESTAURANT real (pas cu pas)

Fluxul e **auto-servire + aprobare admin** (nu ai nevoie de invite manual). Probat E2E
(`tests/rpc/52_onboarding_e2e.sql`).

**4.0 — Un cont admin real (o singură dată):**
Creează-ți un cont prin `/login` → „Creează unul", apoi în SQL editor pe proiectul live:
```sql
update public.profiles set role = 'platform_admin' where id = '<uid-ul-tău>';
```

**4.1 — Restaurantul se înregistrează:**
1. Proprietarul intră pe domeniu → „Intră în cont" → **Creează cont** (ca și client).
2. În meniul de sus apare **„Devino partener"** → `/devino-partener`.
3. Completează: nume restaurant, **slug** (partea din URL, ex. `trattoria-nona`), adresă,
   sector, tip bucătărie, taxă livrare, comandă minimă. Încarcă documente KYC (buletin).
   → creează o `onboarding_application` (status `pending`).

**4.2 — Tu (admin) aprobi:**
1. `/platform` → **Onboarding** (badge cu numărul de cereri). Vezi cererea + documentele KYC.
2. **Aprobă.** Sistemul creează automat: restaurantul (INACTIV), leagă proprietarul ca
   staff, îi setează rolul `restaurant_partner`, și seedează **ore implicite 10:00–22:00**
   toată săptămâna (ca să poată primi comenzi imediat ce-l activezi).

**4.3 — Restaurantul își configurează:**
- Se loghează → `/restaurant/menu`: adaugă categorii, preparate (fotografie + descriere
  OBLIGATORII), modificatori (mărime/extra).
- `/restaurant/hours`: ajustează orele reale + comutatorul „Accept comenzi".
- Vede o **bandă „Cont în așteptare de activare"** cât timp e inactiv.

**4.4 — Tu (admin) activezi + pui coordonatele reale:**
1. `/platform` → **Restaurante**. Fiecare rând are coloana **Locație**.
2. **Coordonate reale** (critice pentru dispatch/ETA): dacă scrie „⚠ lipsă", apeși
   **„Geolocalizează"** — geocodează automat adresa (OpenStreetMap/Nominatim). Dacă adresa
   nu se rezolvă, apeși **„manual"** și lipești `lat`/`lng` din Google Maps → „Salvează".
   (Restaurantele create prin formularul admin se geolocalizează singure; cele venite prin
   onboarding self-service au nevoie de acest pas.)
3. Comutatorul **Activ** pe rând → restaurantul e LIVE și primește comenzi.

---

## 5. Operare ZILNICĂ

### 5.1 Restaurant (`/restaurant/orders`)
- Comandă nouă → **alertă sonoră + titlu + favicon** + push. Apeși **Accept** (pornește
  cronometrul SLA de 7 min — dacă nu accepți, se anulează automat) sau **Refuz** (cu motiv).
- Când e gata: **„Gata de ridicare"** → motorul de dispatch oferă comanda unui curier.
- `/restaurant/analytics`: ore populare, top preparate, rating. `/restaurant/earnings`:
  vânzări + payout-uri (brut/comision/net).

### 5.2 Curier (`/deliveries`)
- Merge **Online** → primește **oferte de 30s** (câștig afișat). Acceptă → livrează:
  „Am ajuns la restaurant" → „Ridicat" → „În drum" → „Livrat" (+confirmă încasarea cash).
- **Numerar în mână**: plafon 1500 MDL (1000 pentru curieri <30 zile). La plafon → trece
  automat offline până predă banii. `/earnings`: câștiguri + tarif curent.

### 5.3 Admin — Centrul operațional (`/platform`)
Tabloul de bord live (kanban comenzi pe etape, flotă, metrici dispatch). Zilnic:
- **Cozi** (`/platform/queues`): comenzi blocate (SLA depășit / fără curier) → anulează cu
  motiv sau forțează statusul. **Reasignează curier** dacă unul a dispărut.
- **Reclamații** (`/platform/ratings`): rating-uri ≤3 stele cu comentarii → intervii.
- **Semnalări** (`/platform/fraud`): teleportări GPS, drift cash (signal-only).
- **Plăți** (`/platform/payouts`): generează payout-uri (buton), marchează plătit,
  clawback pe refund. Rulezi periodic (ex. săptămânal).
- **Onboarding**: aprobi restaurante/curieri noi.

### 5.4 Banii (cum circulă un leu)
Client plătește (cash la curier sau card mock) → curierul colectează cash (intră în
plafonul lui) → la livrare se stampează tariful curierului + payout-ul restaurantului →
`admin_generate_payouts` decontează (curier: tarif − comision 15%; restaurant: vânzări −
comision 20%). Comisioanele sunt **versionate** (`/cum-functioneaza` arată istoricul public)
și payout-ul folosește versiunea în vigoare la data livrării. Refund pe cash inversează
automat soldul curierului.

---

## 6. TROUBLESHOOTING

| Simptom | Cauză probabilă | Ce faci |
|---|---|---|
| Comenzi „blocate" pe `/platform` | Niciun curier online cu capacitate | Verifică curieri online; anulează/forțează din Cozi |
| Comandă gata dar fără curier | Curieri offline / prea departe / cash la plafon | Adu curieri online; `admin_assign_courier` manual |
| Curierul nu primește oferte | Locație implauzibilă (teleport guard) sau fără capacitate | Verifică GPS-ul curierului; are deja o livrare activă? |
| Restaurantul nu vede comenzi | Nu e activat (`is_active=false`) sau ore greșite | Activează-l (§4.4); verifică orele |
| „Trecut offline automat" fals | (reparat) — curier cu ofertă stray | Deja fixat; dacă reapare, verifică `dispatch_offers` |
| Push nu ajunge | VAPID lipsă / cron drain pe URL greșit | Setează cheile VAPID + repointează jobul (§2, §3) |
| Erori `ECONNREFUSED` / `transformAlgorithm` în log | Backend Supabase inaccesibil (pauzat/restart) | Ține backend-ul always-on (plan Pro); e simptom, nu bug de cod |
| Plata online nu merge | E mock intenționat | Ține `NEXT_PUBLIC_ENABLE_ONLINE_PAYMENT=false`, folosește COD |

**Verificare rapidă „merge tot":**
```bash
supabase db reset && bash scripts/test-rpc.sh   # 52/52 verde = tot lanțul operațional OK
```
`tests/rpc/51_operational_e2e.sql` = comanda completă place→payout;
`52_onboarding_e2e.sql` = onboarding restaurant.

---

## 7. Limitări și riscuri cunoscute (fii transparent cu restaurantele)

- **Plăți reale:** doar COD (cash) e complet. Plata online e mock (fără PSP MAIB/PayNet
  integrat). Pentru pilot, COD e ok.
- **Coordonate restaurant:** se setează din UI admin (buton „Geolocalizează" pe
  `/platform/restaurants`, cu fallback manual lat/lng) — fără SQL.
- **App mobil curier (Expo):** prototip — poziția proprie a curierului e reală, dar pinurile
  restaurant/adresă pe hartă sunt încă sintetice. Pentru pilot, folosește suprafața WEB de
  curier (`/deliveries`), care e completă.
- **Retenție KYC:** documentele de identitate se purjează automat pentru cererile respinse
  (90 zile) / abandonate (180 zile); cele aprobate se păstrează.
- **Backend free-tier se pauzează** — de aceea recomand plan Pro pentru pilot (§2).
- **OSRM (rutare reală):** self-hosted local; în prod fără el, ETA cade pe haversine
  (aproximativ, ok pentru zonă densă mică).

---

## 8. Recomandarea mea de secvență pentru pilot

1. Proiect Supabase Pro dedicat + `db push` (§2). *[decizia ta + costul de $25/lună]*
2. Deploy pe Vercel + domeniu + env (§3). *[necesită OK-ul tău pentru deploy]*
3. Cont admin real, șterge conturile de test (§4.0, §3 checklist).
4. Onboardează 1–2 restaurante-pilot reale + coordonate reale (§4).
5. 3–5 curieri cunoscuți (onboarding curier, același flux).
6. Rulezi o zonă densă mică (10–25 restaurante / 5–15 curieri) și urmărești
   `/platform/pilot` (KPI go/no-go: brut/tură, așteptare, marjă, satisfacție).

Pașii 1 și 2 cer decizii/aprobări de la tine (cost + deploy). Spune-mi și le pregătesc/execut.
