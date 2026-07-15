# Issues deschise (clasificate impact/risc/efort)

## Securitate (ține bucla activă)
- [ ] /enter/[role] doorway demo: parole test hardcodate în route handler — OK pt faza locală, ȘTERGE la lansare (impact mare atunci, efort mic)
- [ ] SUPABASE_SERVICE_ROLE_KEY absent → invite parteneri/curieri din UI admin pică politicos; userul îl ia din Dashboard→Settings→API când vrea

## Stabilitate
- [ ] Zero teste automate (vitest/playwright) — fluxurile critice (place_order math, statusMachine, RLS per rol) merită suite; efort mediu
- [ ] subscribeTable: onDegraded există dar nefolosit de consumatori (fallback polling nefăcut)

## Mentenabilitate
- [x] require*-helpers unificate în src/lib/auth/require.ts (it. 15)
- [ ] CateringRequestForm ~300 linii → split în secțiuni

## Documentație
- [ ] docs/architecture.md lipsă (harta: 3 suprafețe, RPC contract, realtime design)
- [ ] Contract RPC-uri nedocumentat (nume, parametri, cine are voie)

## Minor (acceptat/documentat)
- [x] 404 pe slug inexistent întoarce 200 pe shell-ul streamed (cosmetic, documentat W6)
- [ ] Mobile client: comanda merge pe contul autentificat în app; fluxul de signup e minimal
