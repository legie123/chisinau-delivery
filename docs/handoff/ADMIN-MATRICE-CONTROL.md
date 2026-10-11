# ADMIN — matricea de control (gate 3) și decizii BLOCKED

> 2026-10-12, sesiunea ADMIN-2 („ADMIN delivery APP”, worktree `~/code/cd-admin`, branch `sector/admin-audit`).
> Panoul Bolt nu e public: controalele sunt derivate din ce trebuie operat în celelalte trei aplicații.
> Coloana „dovadă” = fișierul care dovedește starea; re-verifică înainte să construiești.

## Matricea de control
| control | stare | dovadă | blochează o comandă reală? |
|---|---|---|---|
| Hartă live comenzi + curieri | EXISTĂ | `src/app/(admin)/platform/OpsLive.tsx:12` (`OpsMap`), `admin_fleet_status` | nu |
| Anulare comandă | EXISTĂ | `platform/queues/actions.ts` `cancelStuckOrder` | nu |
| Realocare curier | EXISTĂ | `platform/queues/ReassignCourierControl.tsx`, `admin_reassign_courier` | nu |
| Forțare avans de status | EXISTĂ | `platform/queues/actions.ts` `forceAdvance` | nu |
| Refund client cu limite | PARȚIAL — doar status `paid → refund_pending → refunded`, fără sumă, fără plafon, fără motiv obligatoriu | `platform/queues/PaymentActions.tsx:10-12` | nu (blochează disputele) |
| Reclamații + ajustări de plată | EXISTĂ (ADMIN, 0404/0406) | `platform/orders/[id]/actions.ts` | nu |
| Comenzi blocate cu motivul real | EXISTĂ (gate 2, ADMIN) | `admin_stuck_orders`, `20261012000405_no_courier_cutoff` | nu |
| Restaurant: onboarding | EXISTĂ | `platform/onboarding/actions.ts` `reviewApplication` | nu |
| Restaurant: pin | EXISTĂ — dar vezi BLOCKED B1 | `platform/restaurants/actions.ts` `setRestaurantLocation` | nu |
| Restaurant: program (din admin) | LIPSĂ în UI admin (DB permite prin `has_restaurant_access`) | — | nu |
| Restaurant: comision individual | LIPSĂ — comisionul e global (`pricing_config`) | `platform/payouts/page.tsx:8` | nu (decizie business) |
| Curieri: aprobare documente | EXISTĂ | `platform/onboarding/page.tsx` (URL-uri semnate KYC) | nu |
| Curieri: suspendare / reactivare | EXISTĂ | `CourierSuspensionControl.tsx`, `suspendCourierAction`/`reinstateCourierAction` | nu |
| Pricing: taxă livrare, suprataxă, podea cotație | PARȚIAL — RPC-uri versionate (`set_pricing_config`, `set_courier_tariff`), fără UI de editare | `packages/shared-api/src/tariff.ts` | nu |
| Finanțe: depunere cash | EXISTĂ | `CashOffloadControl.tsx`, `record_cash_offload` | nu |
| Finanțe: vizualizare ledger cash | LIPSĂ | — (`courier_cash_movements` fără pagină) | nu |
| Finanțe: payouts | EXISTĂ (ADMIN: cron 0401, conturi 0402, ajustări 0406) | `platform/payouts/actions.ts` | nu |
| Roluri + permisiuni | LIPSĂ în UI (doar SQL) | — | nu |
| Audit al intervențiilor | DB GATA (gate 1, `20261012000490`), LIPSĂ în UI | `admin_audit_log` | nu |
| Rapoarte | EXISTĂ | `platform/pilot`, `crm`, `ratings`, `fraud` | nu |

Nicio lipsă din panou nu blochează azi o comandă reală: fluxul comandă → restaurant → curier → bani e operabil din admin. Golurile sunt de control și de urmă.

## BLOCKED — decizii ale owner-ului
### B1. Pinul restaurantului mutat între „gata” și „livrat” (gate 1, caz obligatoriu)
Plata finală a curierului = `greatest(cotația stampilată la mark_ready_for_pickup, recalculul la predare din coordonatele CURENTE ale restaurantului)` (`advance_delivery_status`). Probă rolled-back, aceeași comandă (~2 km):

| caz | cotație | plătit |
|---|---|---|
| pin neschimbat | 42,01 | 42,01 |
| adminul mută pinul ~5 km mai DEPARTE | 42,01 | **72,03 (+71 %)** |
| adminul mută pinul mai APROAPE | 42,01 | 42,01 (podeaua îl protejează) |

Curierul e plătit pe o distanță pe care n-a parcurs-o; schimbarea apare acum în `admin_audit_log`.
Opțiuni:
1. **Blocare cât există comenzi în curs** (recomandat acum): pinul restaurantului nu se poate muta cât restaurantul are comenzi `ready_for_pickup … en_route` — aceeași regulă ca `addresses_guard_in_flight`. Un trigger, nicio funcție de bani atinsă.
2. **Fotografie la „gata”**: `mark_ready_for_pickup` salvează coordonatele de ridicare pe comandă, plata se calculează din ele. Corect și pe termen lung, dar atinge funcțiile RESTAURANT + CURIER.
3. **Doar alertă**: lași calculul, alertă ops la mutarea pinului cu comenzi în curs, revizie manuală la payout.

### B2. Refund către client: sumă și plafon
Azi refund = doar schimbare de status, integral. De decis: refund parțial (sumă), plafon fără aprobare suplimentară (ex. ≤ valoarea comenzii, ≤ X MDL/zi/admin), motiv obligatoriu.

### B3. Comision per restaurant
Azi un singur comision global. De decis dacă restaurantele negociază comisioane diferite.
