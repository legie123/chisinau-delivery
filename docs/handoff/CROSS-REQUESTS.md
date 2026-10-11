# Cereri între sesiuni (CLIENT · CURIER · RESTAURANT · ADMIN)

O linie per cerere, cea mai nouă jos. Proprietarul (vezi tabelul din oricare HANDOFF) o preia, o face și scrie „→ făcut <sha>”.
Format: `- [AAAA-LL-ZZ] DE→CĂTRE · ce · de ce · dovadă (fișier:linie)`

- [2026-10-11] CLIENT→RESTAURANT · „Epuizat” cu coloană separată (nu is_available) + UI partener · azi is_available=false înseamnă și „ascuns”, RLS îl ascunde publicului (pg_policies menu_items_public_read) · CLIENT face apoi garda în place_order + randarea „Epuizat” în mobile/client.
