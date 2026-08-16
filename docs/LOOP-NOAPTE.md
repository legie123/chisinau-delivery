# LOOP-NOAPTE — 24h de construcție autonomă
Start: 2026-08-16 · repo `chisinau-delivery` · branch `main`
Memoria buclei. Fiecare val citește fișierul ăsta, execută DOAR valul marcat **NEXT**, apoi îl actualizează și iese.

Constructor: `~/.claude/scripts/noapte-bucla.sh` (valuri `claude -p`, verificare externă după fiecare)
Supervizor: agent Perplexity pe cron, la fiecare oră — citește `~/.claude/state/noapte/heartbeat.json` + jurnalul de mai jos, decide, rescrie NEXT, repornește constructorul dacă a murit.
Rubrica vizuală: `docs/DESIGN-IMERSIV-4-SECTOARE.md`. Protocolul: `~/.claude/commands/bucla.md`.

## Reguli active

- Un val = o țintă. Commit atomic. Fără deploy, fără push, fără migrări distructive, fără atins tabelele Trade-AI.
- Verificarea e externă: `npm run verify` plus capturi 390×844 și 1440×900, deschise și privite. Un build verde nu e dovadă de UX.
- Gate roșu de 2 ori ⇒ scrie blocajul în `.bucla/issues.md`, comite ce e verde, mută NEXT, ieși. Nu insiști.
- Buget: dacă apare plafon de tokeni, constructorul doarme 20 de minute și reia — nu arde valuri în gol. Fereastra de 5h se resetează la 07:00; bugetul de 7 zile e aproape terminat și se resetează luni, deci valurile grele de generare media au prioritate mai mică decât reparațiile de UX.
- Ordinea priorităților: bug de sens > text tăiat/ilizibil > ierarhie greșită > sistem de atmosferă > assets noi generate.
- Assetul nou intră doar dacă bate vizibil vechiul. Altfel rămâne vechiul și motivul se scrie în jurnal (lecția din `79659f7`).

## Roadmap (24h, în ordinea impactului)

Reparațiile întâi, atmosfera după. Așa nu îmbrăcăm frumos ecrane care încă mint.

- [x] **V1** · Reparațiile văzute și netratate, toate patru într-un val: subtitlul mort „PREMIUM FOOD DELIVERY" scos de unde nu are ce căuta; cardurile de client cu text tăiat (clamp pe 2 rânduri, nu font mai mic); plăcile opace de sub text pe concierge înlocuite cu gradient corect pe imagine; indicatorii înghesuiți din panoul restaurantului aerisiți. Capturi înainte/după pentru fiecare. → `31151ca` (+ `812b0a5` tipuri, `2efdf86` lint)
- [ ] **V2 — NEXT** · Cauza rădăcină a lui „-24.9 min" din panoul restaurantului. Minute negative = bug de calcul sau etichetă greșită. Test care mușcă înainte de fix. Nu se ascunde semnul minus.
- [ ] **V3** · `SectorBackdrop.tsx` + `sectors.ts` — contractul din secțiunea 2 a rubricii, cu cele 3 niveluri (`ambient`/`hero`/`focus`) și lanțul de fallback video→poster→gradient, fără layout shift. Migrează cele 2 locuri care folosesc acum video-uri direct (`start/restaurant`, `concierge`). Zero regresii vizuale.
- [ ] **V4** · `higgsfield-brandkit` alimentat cu `docs/design/dragons-dna.json` → paletă consolidată, marcă SVG, scară tipografică, tokeni în Tailwind. Assetul oficial existent nu se rescrie, se extinde.
- [ ] **V5** · Sector CURIER îmbrăcat: `sector-courier.mp4` generat cu promptul din rubrică, `ambient` pe `/deliveries`, `focus` 2s la acceptarea cursei. Auriul rămâne exclusiv pentru bani.
- [ ] **V6** · Sector CONCIERGE: `sector-concierge.mp4` comparat cadru cu cadru cu `hero-spa.mp4` și `hero-lounge.mp4` existente. Câștigătorul rămâne, chiar dacă e cel vechi. `hero` la intrare, `focus` la rezervare confirmată.
- [ ] **V7** · Sector CLIENT: `hero_banner` ×3 + `social_carousel` ×8 pentru tentele per bucătărie, cu direcția luminii consistentă în tot setul. Video doar pe hero, niciodată sub liste.
- [ ] **V8** · Sector RESTAURANT: cel mai discret. Video doar pe `/start/restaurant` și login. În panou măsori întâi dacă video-ul fură cadre; dacă da, gradient static și scrii măsurătoarea.
- [ ] **V9** · Trecere de performanță pe tot imersivul: fiecare video sub 1.5 MB, poster peste tot, `preload="none"` sub fold, `prefers-reduced-motion` respectat, zero CLS. Măsoară înainte/după, scrie cifrele.
- [ ] **V10** · Trecere de accesibilitate și contrast pe cele 4 sectoare: 4.5:1 minim pentru orice text peste video sau gradient, focus vizibil, ținte de atingere ≥44px.
- [ ] **V11** · Val adversarial: caută minciuni de interfață — stări afișate care nu corespund stării reale, butoane care nu fac ce promit, etichete care descriu greșit ce e dedesubt. Raport + reparații.
- [ ] **V12** · Bilanț: capturi finale pe toate 4 sectoarele la ambele dimensiuni, jurnalul consolidat, listă ordonată de ce a rămas deschis. Fără laudă.

După V12, dacă mai e timp în cele 24h: valurile se reia din `.bucla/issues.md`, cel mai dureros element primul.

## Jurnal

Fiecare val scrie exact 3 rânduri: ce a livrat · cu ce dovadă · ce a văzut și n-a reparat.

- **V1 · 2026-08-16 · livrat**: subtitlul englezesc scos de pe `/restaurants`; cardurile de descoperire nu mai taie bucătăria și nu mai rup nota în două (clamp 2 rânduri + tooltip); un singur `.photo-scrim` cu trepte în pixeli plus umbră de text înlocuiește placa opacă de pe cardurile și hero-ul concierge (blurbul scade la o linie, ca în rubrică); indicatorii partenerului devin grilă aliniată cu perioada spusă o dată. Bonus, aceeași clasă de defect pe aceleași ecrane: banda „Reconectare…" scria peste navigarea partenerului (mutată jos) și estimarea se rupea între „~34" și „min".
- **V1 · dovezi**: capturi înainte/după la 390×844 și 1440×900 pentru client, concierge și partener, deschise și privite (`/tmp/v1-before`, `/tmp/v1-after`, `/tmp/v1-final`) — prima versiune a voalului a fost prinsă exact așa, punea eticheta aurie pe podeaua albă, și a fost refăcută înainte de commit; `npm run verify` verde (drift + tsc + 56/56), `npm run lint` 0 erori (2 preexistente reparate), `npm run build` compilat.
- **V1 · văzut și nereparat**: antetul de brand de pe `/restaurants` mănâncă tot primul ecran de telefon (dragon + „DRAGONS DELIVERY", repetat din navigare) — căutarea începe abia la 560px din 844; `OffersLive` la curier are exact aceeași bandă `top-3` care va cădea peste bara lui de comandă, lăsată pentru sectorul curier; pe `/concierge` fundalul video curge sub toată pagina, nu doar sub hero — treaba lui V3 (`intensity`); „-24.9 min" e acum mai vizibil, nu ascuns — V2.

## Blocaje

- (niciunul în V1 — toate porțile au trecut)
