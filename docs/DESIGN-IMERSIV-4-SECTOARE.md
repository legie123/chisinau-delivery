# DESIGN IMERSIV — 4 SECTOARE
Rubrica vizuală a platformei Dragons Delivery Chișinău. Sursa de adevăr pentru orice atingere de design.
Repo: `~/code/chisinau-delivery` · pornire de la `1b05b39`

## 0. De ce documentul ăsta există

Imersivul a fost încercat deja de două ori și a dat înapoi o dată: `486a8f6` a pus un backdrop generat per sector, `74c98da` l-a înlocuit cu un „living silk" pe shader, iar `79659f7` a făcut revert la video-uri fiindcă shader-ul arăta mai prost. Lecția plătită: **nu înlocuim ceva ce funcționează cu ceva ce sună mai avansat.** Orice asset nou intră doar dacă bate ce e acum, dovedit cu captură înainte/după la 390×844.

A doua constatare, din `grep`: video-urile de sector sunt referite în exact 2 fișiere (`(marketing)/start/restaurant`, `(customer)/concierge`). Nu există niciun `SectorBackdrop`. Deci nu retușăm un sistem — îl construim, o dată, cu un singur contract și 4 configurații.

## 1. Legea imersiunii (se aplică la toate 4)

Imersiv nu înseamnă „mai mult efect". Înseamnă că **ecranul îți spune unde ești înainte să citești un cuvânt**, și că nimic din atmosferă nu întârzie acțiunea care aduce bani.

Cinci reguli neneogociabile:

1. **Atmosfera stă în spate, comanda stă în față.** Fundalul nu concurează niciodată cu butonul principal. Contrast minim 4.5:1 pentru text peste orice video sau gradient — cu un strat de întunecare între ele, nu cu noroc.
2. **Prima acțiune, sub degetul mare.** Pe telefon, lucrul de care depinde venitul utilizatorului stă în treimea de jos sau în bara de comandă de sus. Nimic secundar nu trece înaintea lui (regula câștigată pe ecranul curierului, `a4004de`).
3. **Un asset care nu se încarcă în 2 secunde pe 4G nu există.** Poster JPG întotdeauna, `preload="none"` sub fold, video sub 1.5 MB per sector, `autoplay muted playsInline loop`, oprire la `prefers-reduced-motion` și la baterie scăzută.
4. **Mișcarea are un motiv sau nu are loc.** Tranziții 180–260 ms, easing calm. Nimic care pulsează, nimic care sare, nimic care se rotește fără sens. Un curier care se uită la telefon în ploaie nu are răbdare de coregrafie.
5. **Nicio etichetă care minte.** „Restaurant" pe un spa a fost un bug de sens, nu de stil. Starea afișată = starea reală, întotdeauna.

## 2. Contractul tehnic — un singur component

`src/components/immersive/SectorBackdrop.tsx`:

```
type Sector = "courier" | "restaurant" | "concierge" | "customer";
<SectorBackdrop sector={Sector} intensity="ambient" | "hero" | "focus" />
```

Un singur fișier de configurație, `src/components/immersive/sectors.ts`, ține pentru fiecare sector: sursa video, posterul, gradientul de întunecare, culoarea de accent, amplitudinea de mișcare și fallback-ul static. Toate valorile derivă din `docs/design/dragons-dna.json` — nu se inventează culori noi.

Trei niveluri, ca să nu punem film peste tot: `ambient` (fundal liniștit sub UI de lucru), `hero` (deschiderea unui ecran, o singură dată), `focus` (moment de confirmare — comandă plasată, cursă acceptată).

Ierarhia de fallback, în ordine: video → poster → gradient CSS. Fără layout shift între ele. Un sector fără video încă generat arată corect, nu gol.

## 3. CURIER — noaptea orașului, o mână liberă

Adevărul sectorului: om pe stradă, în mișcare, cu o singură mână liberă, care vrea să știe cât a făcut azi și să treacă online. Deja reparat în `a4004de`; aici doar îmbrăcăm ce e corect.

Atmosferă: noapte de Chișinău, asfalt umed, lumini de stradă defocalizate care trec lent — nu un video care distrage, o pâlpâire de oraș la 8% opacitate în spatele barei de comandă. Accentul auriu rămâne exclusiv pentru bani: câștigul zilei, nimic altceva. Verde doar pentru „online". Roșu doar pentru ceva care îl costă acum.

`intensity`: `ambient` pe `/deliveries`, `focus` o singură dată la acceptarea cursei (2 secunde, apoi se stinge).

Higgsfield:
```
higgsfield-generate — model Seedance 2.0, 5s, loop perfect, 1080x1920
"Chișinău street at night from a courier's point of view, wet asphalt reflecting
warm streetlights, shallow depth of field, lights defocused into soft bokeh,
slow forward drift, no people, no text, no logos, cinematic, muted teal shadows
with warm amber highlights, seamless loop"
```
Ținta: `public/videos/sector-courier.mp4` + poster. Sub 1.2 MB. Dacă iese peste, se reduce la 720×1280 înainte de orice altă idee.

De reparat aici, văzut deja: subtitlul mort „PREMIUM FOOD DELIVERY" nu are ce căuta pe niciun ecran de curier.

## 4. RESTAURANT — căldură de cuptor, densitate de date

Adevărul sectorului: operator la tejghea, în vârf de comenzi, cu 20 de secunde de atenție. Are nevoie de densitate lizibilă, nu de artă. Aici imersivul e cel mai discret din toate patru.

Atmosferă: căldură de cuptor — chihlimbar profund pe margini, centrul curat și rece ca să lase datele să respire. Video doar pe `/start/restaurant` și pe login (`hero`); în panoul operațional exclusiv `ambient`, la 5%, sau chiar gradient static dacă măsurătoarea arată că video-ul fură cadre pe tabletele lor.

De reparat, văzut deja și netratat:
- indicatorii înghesuiți din panou, cu acel **„-24.9 min"** — un număr negativ de minute e ori un bug de calcul, ori o etichetă greșită. Se investighează cauza, nu se ascunde semnul minus.
- ierarhia panoului: comenzi noi > timp de preparare > încasări. Nu invers.

Higgsfield:
```
higgsfield-generate — Seedance 2.0, 5s, loop, 1920x1080
"Close macro of a professional kitchen at service time, ember glow from an oven,
steam catching warm light, dark background, extremely shallow focus, slow
breathing motion, no people, no faces, no text, seamless loop"

higgsfield-product-photoshoot --mode product_shot --count 6
"signature dishes of the partner restaurants, top-down and 45 degrees, dark
slate surface, warm directional light, appetizing steam, no props competing
with the food"
```
Fotografia de mâncare aparține clientului (secțiunea 6), dar se generează o dată, de aici, ca să fie același limbaj vizual în ambele sectoare.

## 5. CONCIERGE — lounge, lent, premium

Adevărul sectorului: platforma nu mai e livrare, e o rețea de locuri (`5c885e8`, `2bdc790`). Spa, lounge, săli de business, rezervări care apoi comandă catering (`c50463f`). Aici imersivul are cel mai mult drept de existență — omul cumpără o senzație, nu un pachet.

Atmosferă: lounge la ora albastră. Mișcare lentă, aer, spațiu negativ generos. Serif auriu pentru titluri, un singur accent pe ecran. Cardurile de loc respiră: imagine mare, o linie de promisiune, un buton.

De reparat, văzut deja: **plăcile de sub text** (bucăți de fundal opac puse ca să se citească textul) — se înlocuiesc cu un gradient de întunecare corect pe imagine, nu cu dreptunghiuri lipite.

Regula de sens câștigată deja: un spa nu apare niciodată în lista de restaurante. Invers la fel — un local care doar livrează mâncare nu se rezervă din concierge.

`intensity`: `hero` la deschiderea `/concierge`, `ambient` pe pagina locului, `focus` la rezervare confirmată.

Higgsfield:
```
higgsfield-generate — Seedance 2.0, 6s, loop, 1080x1920
"Luxury spa and lounge interior at blue hour, warm lamps against deep teal
shadows, steam rising slowly from thermal water, empty elegant space, no people,
no text, very slow camera drift, cinematic anamorphic, seamless loop"
```
Ținta: `sector-concierge.mp4`. Există deja `hero-spa.mp4` și `hero-lounge.mp4` — se compară cadru cu cadru și **câștigătorul rămâne**, chiar dacă e cel vechi.

## 6. CLIENT — poftă, apetit, aur

Adevărul sectorului: om flămând, seara, care decide în 15 secunde. Imersivul lui e mâncarea, nu decorul. Un video de fundal care fură atenția de la fotografia mâncării e o pierdere netă.

Atmosferă: întuneric cald, fotografia mâncării ca eroul absolut, tentele per bucătărie deja existente păstrate, serif auriu pentru identitate. Video doar pe hero-ul de deschidere (`hero-flame.mp4` există și e potrivit), niciodată sub listele de restaurante.

De reparat, văzut deja: **cardurile de client cu text tăiat** — cauza probabilă e o înălțime fixă pe un titlu variabil; se repară cu clamp explicit pe 2 rânduri plus tooltip, nu cu font mai mic.

Higgsfield:
```
higgsfield-product-photoshoot --mode hero_banner --count 3
"appetizing hero for a premium delivery brand, dark warm scene, single dish in
sharp focus with ember light behind, gold accents, luxurious but honest food,
no text overlay"

higgsfield-product-photoshoot --mode social_carousel --count 8
"cuisine category covers: sushi, grill, pasta, breakfast, desserts, vegan,
burgers, soups — consistent dark warm treatment, same light direction across
the whole set"
```
Setul de 8 acoperă tentele per bucătărie. Consistența direcției luminii în tot setul e criteriul de acceptare — dacă un card are lumina din partea greșită, se regenerează doar el.

## 7. Brand, o singură dată

`higgsfield-brandkit`, alimentat cu `docs/design/dragons-dna.json` și cu dragonul deja folosit în produs, produce: paleta consolidată, marca în SVG la 3 dimensiuni, scara tipografică, și tokenii exportabili în Tailwind. Rulat **înainte** de orice generare de video, ca toate cele 4 sectoare să iasă din același ADN. Assetul oficial existent nu se rescrie — se extinde.

## 8. Criterii de acceptare (fără ele valul nu e făcut)

Pentru fiecare sector, în ordine:
- captură 390×844 și 1440×900, înainte și după, deschise și privite
- `npm run verify` verde
- text: zero tăieri, zero suprapuneri, zero contrast sub 4.5:1
- performanță: video sub 1.5 MB, poster prezent, `prefers-reduced-motion` respectat, zero layout shift la fallback
- sens: nicio etichetă care descrie greșit ce e dedesubt
- comparație cinstită: dacă noul asset nu bate vizibil vechiul, rămâne vechiul și se scrie de ce în jurnal
