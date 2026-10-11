# Matricea de interacțiune (GATE I1) — un singur document, toate sectoarele

Reguli: completezi DOAR rândurile în care sectorul tău emite sau reacționează. Nu rescrii rândul altui sector; dacă nu ești de acord, adaugi sub el `> DEZACORD <SECTOR>: …`.
Dovada = sim / test / scenariu de sistem care pică dacă interacțiunea se rupe (cu mutația care îl face roșu).
Claims (Ruflo nu e disponibil în sesiuni — e în carantină): revendici în `docs/handoff/CROSS-REQUESTS.md` cu formatul „cine · ce · de când · stare”.

| eveniment | emite | trebuie să reacționeze | ce vede fiecare aplicație | dovadă |
|---|---|---|---|---|
| Admin realocă curierul (`admin_reassign_courier`) | ADMIN | CURIER (vechi pierde, nou primește), CLIENT, RESTAURANT | client: alt curier pe tracking · curier vechi: nu mai poate avansa („not authorized”) · curier nou: poate ridica/livra · restaurant: cardul curierului se schimbă · admin: rând în audit (courier_id vechi→nou) | sim 291.7.1 (mutație: fără audit → roșu) |
| Admin anulează în timpul livrării (`cancel_order` ca admin) | ADMIN | CURIER, CLIENT, RESTAURANT, ledger | client: `cancelled` prin RLS · curier: eliberat la `online`, livrarea refuzată · restaurant: comanda iese din coadă · oferte vii: niciuna · timeline: `cancelled` cu actor `platform_admin` · audit: en_route→cancelled | sim 291.7.2 (mutație: cancel fără eliberare curier → roșu) |
| Admin face refund (`admin_update_payment_status` paid→refund_pending→refunded) | ADMIN | CLIENT, ledger/payouts | client: `refunded` · audit: ambii pași · payouts: clawback — **neacoperit încă de scenariul 7** (de adăugat de ADMIN-finanțe) | sim 291.7.3 |
| Admin mută pinul restaurantului între „gata” și „livrat” | ADMIN (sau RESTAURANT) | CURIER (plata), CLIENT (harta) | curier: plătit `greatest(cotație, recalcul cu pinul NOU)` → +71 % la 5 km mai departe · audit: rând pe restaurants | probă rolled-back în `ADMIN-MATRICE-CONTROL.md` §B1 — **BLOCKED pe owner**, testul de sistem 8 se scrie după decizie |
| Orice mutație de admin (inclusiv prin Server Action service_role) | ADMIN | ADMIN (audit), toate (ce s-a schimbat la ele) | admin: `/platform/audit` cine/ce/când/vechi→nou, date personale `***` | sim 290 (9 aserțiuni, fiecare roșie prin mutație) + apel REST real |
| Adminul aprobă înscrierea (`review_onboarding_application`) | ADMIN | CURIER / RESTAURANT | solicitantul primește rolul; curierul aprobat — cum își primește login-ul în aplicație: **neacoperit** | — (de scris de ADMIN) |
| Adminul suspendă / reactivează curierul | ADMIN | CURIER, dispecerizarea | curier: offline, fără oferte · admin: audit | — (de scris de ADMIN) |
| Plăți săptămânale generate / marcate plătite | ADMIN | CURIER, RESTAURANT | câștigurile lor arată plata | sim 250+ (ADMIN-finanțe) |
