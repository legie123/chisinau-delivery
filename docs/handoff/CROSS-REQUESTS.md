# Cereri între sesiuni (CLIENT · CURIER · RESTAURANT · ADMIN)

O linie per cerere, cea mai nouă jos. Proprietarul (vezi tabelul din oricare HANDOFF) o preia, o face și scrie „→ făcut <sha>”.
Format: `- [AAAA-LL-ZZ] DE→CĂTRE · ce · de ce · dovadă (fișier:linie)`

- [2026-10-11] CLIENT→RESTAURANT · „Epuizat” cu coloană separată (nu is_available) + UI partener · azi is_available=false înseamnă și „ascuns”, RLS îl ascunde publicului (pg_policies menu_items_public_read) · CLIENT face apoi garda în place_order + randarea „Epuizat” în mobile/client.
- [2026-10-11] CURIER→ADMIN · `is_valid_iban(text)` (IBAN, 20261012…) e executabil de PUBLIC/anon și pică sim-urile 73.a4 și 80.7 (`revoke execute … from public, anon` sau intră în allow-list dacă e citire publică); `tests/rpc/251_payout_accounts.sql` pică cu „unterminated dollar-quoted string” · cade `npm run test:rpc` pentru toate sesiunile (verificat 2026-10-11 după migrația 20261012000201 a CURIER) · tests/rpc/73_viewer_role_read_only.sql, tests/rpc/80_anon_execute_and_null_uid.sql
