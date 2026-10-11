# Matrice de paritate — RESTAURANT (Bolt Food Merchant, doar fluxuri; referință = surse publice din `replica/recon.md`)

Format comun: Flux | stare | fișierul care dovedește | blochează o comandă reală?
Stare verificată în cod/DB la 2026-10-12 (ramura `sector/restaurant` + `main`). Skill-ul de replică nu e instalat: matricea vine din `replica/gap-map.csv` (public-only) + citirea codului.

| Flux | Stare | Dovadă | Blochează o comandă reală? |
|---|---|---|---|
| Login partener + activare cont | EXISTĂ | `src/components/auth/LoginForm.tsx`; `src/proxy.ts` gate `/restaurant/*`; RLS `has_restaurant_access` | nu |
| Roluri în restaurant (proprietar vs bucătărie) | LIPSĂ | `restaurant_staff` are doar id/restaurant_id/user_id/created_at — orice staff vede câștiguri, IBAN, meniu | nu (risc de acces, decizie owner) |
| Comandă nouă: alertă până la acțiune, supraviețuiește tăierii rețelei | EXISTĂ (G2, f9e5340) | `src/components/admin/OrderQueueLive.tsx`, `src/lib/kitchen/queueAlarm.ts`, `tests/kitchen/network-cut.cjs` (pică pe codul vechi, trece acum) | DA — era PARȚIAL: pe o pană reală comanda ajungea invizibilă și fără sunet |
| Escaladare dacă nu e preluată la timp | EXISTĂ (G2, 42688d4) | push la sosire (`enqueue_new_order_push`), push „se anulează în 2 min” (`remind_pending_restaurant_orders`, sim 204), alertă ops la 3 min (`scan_ops_alerts`), anulare automată la SLA (`expire_stale_orders`) | DA — tabletă adormită = comandă anulată fără al doilea semnal |
| Ecran care nu adoarme | EXISTĂ | Wake Lock în `OrderQueueLive.tsx`; `/restaurant/tableta` îl măsoară | da, dacă lipsea |
| Accept / refuz cu motiv | EXISTĂ | `OrderQueueRow.tsx` (motive presetate) → `reject_order` → `orders.cancellation_reason` la client | nu |
| Timp de preparare setat | EXISTĂ | `set_prep_time_estimate` (doar în `pending_restaurant`), mod aglomerat `set_restaurant_busy` (sim 200) | nu |
| Timp de preparare ajustat după acceptare („mai am nevoie de 10 min”) | LIPSĂ | `set_prep_time_estimate` refuză în afara `pending_restaurant` | nu (ETA client greșit) |
| Marcare gata (`mark_ready_for_pickup`) | EXISTĂ | `OrderQueueRow.tsx` „Gata de ridicare” | nu |
| Predare către curier cu verificare | LIPSĂ | niciun cod de ridicare; doar metrica `restaurant_handover_avg_seconds` (`platform/OpsLive.tsx`); curierul trece singur în `picked_up` | nu (risc: comanda dată altui curier) |
| Card curier (nume, telefon, hartă) | EXISTĂ | `restaurant_courier_contact` (sim 201), `orders/page.tsx` | nu |
| Meniu: produse, categorii, poze, modificatori | EXISTĂ | `menu/actions.ts`, `ItemModifiersManager.tsx`; import în masă `menu/import` | nu |
| Toggle rapid stoc epuizat | EXISTĂ (partea restaurant) / PARȚIAL (client) | `/restaurant/stoc`, `set_menu_item_sold_out` (sim 203); garda din `place_order` + randarea la client = CLIENT (CROSS-REQUESTS) | parțial: un produs epuizat se mai poate comanda → restaurantul refuză |
| Program + pauză + aglomerat | EXISTĂ | `HoursForm.tsx`, `AcceptingOrdersToggle.tsx`, `BusyModeControl.tsx` | nu |
| Istoric comenzi | EXISTĂ | `/restaurant/orders/history` (sim 202) | nu |
| Bon tipărit | EXISTĂ | `KitchenTicket.tsx` (58 mm) | nu |
| Decont zilnic | PARȚIAL | doar CSV săptămânal `earnings/export` + plăți săptămânale; nimic pe zi | nu |
| Câștiguri + IBAN | EXISTĂ | `earnings/page.tsx`, `PayoutAccountForm.tsx` | nu |
| Pin restaurant valid | PARȚIAL (date) | 14/14 au pin, dar demo; activarea nu cere pin (G1, HANDOFF §G1) | nu direct (plata curierului pe 6 km = cauza e la client, 28/28) |

Ordinea de construcție în G4 (nimic din ce a rămas nu blochează singur o comandă după G2): ajustarea timpului după acceptare → predarea cu cod (+ cerere CURIER) → decont zilnic → escaladare în aplicație în ultimele 2 min. Rolurile în restaurant = decizie owner (BLOCKED).
