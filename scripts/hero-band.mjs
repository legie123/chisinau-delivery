// Cât de departe ajunge atmosfera, măsurat în pixeli — și unde începe lista.
//
//   node scripts/hero-band.mjs <url> "<selector-primul-element-de-listă>"
//   SHOT_WIDTH=1440 SHOT_HEIGHT=900 SHOT_ROLE= node scripts/hero-band.mjs ...
//
// Regula 1 și §6 din rubrică spun același lucru din două direcții: atmosfera
// stă în spatele DESCHIDERII, niciodată sub liste. Până acum asta se verifica
// din ochi, iar de trei ori la rând (V3 pe /concierge la 1440, V6, V7 pe
// /restaurants) verdictul a fost „încă e acolo, dar o lăsăm". Un criteriu care
// nu se măsoară nu se repară.
//
// Ce măsoară: nu CSS-ul, ci pixelii. Se fotografiază ecranul cu atmosfera
// aprinsă, apoi cu ea stinsă, și se caută CEL MAI DE JOS pixel care s-a
// schimbat. Aia e raza reală a fundalului — indiferent dacă e `fixed inset-0`,
// o bandă `absolute`, un gradient scris de mână sau trei straturi suprapuse.
// Suprapunerea = raza minus vârful primului element de listă. Zero sau
// negativ = curat; orice pozitiv e numărul de pixeli de listă care stau peste
// atmosferă.
//
// Capcana plătită la scris: un film în mișcare face ca DOUĂ capturi ale
// aceluiași ecran să difere peste tot, deci diferența ar raporta „atmosfera
// ajunge până jos" chiar și pentru o bandă corectă. Toate `video`-urile se
// opresc înainte de prima captură (același truc ca în `a11y-audit.mjs`).

import { chromium } from "/Users/user/.npm/_npx/db89d7302a373f10/node_modules/playwright/index.mjs";

const [, , url, selector] = process.argv;
if (!url || !selector) {
  console.error('utilizare: node scripts/hero-band.mjs <url> "<selector>"');
  process.exit(1);
}

const WIDTH = Number(process.env.SHOT_WIDTH ?? 1440);
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 900);
const ROLE = process.env.SHOT_ROLE ?? "";
const SCALE = 2;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: SCALE,
});
const page = await context.newPage();

if (ROLE) {
  const base = new URL(url).origin;
  await page.goto(`${base}/master`, { waitUntil: "domcontentloaded" });
  await context.request.post(`${base}/master/enter/${ROLE}`);
}
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
} catch {
  await page.waitForTimeout(2500);
}
await page.waitForTimeout(1200);

// Filmele se opresc pe primul cadru: altfel diferența dintre cele două capturi
// e mișcarea lor, nu prezența atmosferei.
await page.evaluate(() => {
  for (const v of document.querySelectorAll("video")) {
    v.pause();
    v.currentTime = 0;
  }
});
await page.waitForTimeout(250);

const listTop = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  return Math.round(el.getBoundingClientRect().top);
}, selector);

if (listTop === null) {
  console.error(`selectorul "${selector}" nu se potrivește cu nimic pe ${url}`);
  await browser.close();
  process.exit(2);
}

const before = await page.screenshot();
// CONTROL: aceeași pagină, neatinsă, fotografiată a doua oară. Orice rând care
// se schimbă ÎNTRE ele nu e atmosferă — e o fotografie care tocmai a sosit, un
// cursor care clipește, un cadru de film scăpat. Fără controlul ăsta unealta ar
// raporta „atmosfera ajunge până jos" pentru o bandă perfect mărginită, iar eu
// aș fi reparat ce nu era stricat (sau, mai rău, aș fi declarat reparat ce nu e).
await page.waitForTimeout(250);
const control = await page.screenshot();

// Se stinge orice strat de atmosferă: decorativ (`aria-hidden`), așezat în
// afara fluxului și împins în spate (`z-index: -10`, convenția contractului).
// Prinde și `SectorBackdrop`, și banda de gradient scrisă de mână pe
// /restaurants — de-aia criteriul e pe pixeli, nu pe numele componentei.
const hidden = await page.evaluate(() => {
  let n = 0;
  for (const el of document.querySelectorAll("[aria-hidden]")) {
    const cs = getComputedStyle(el);
    if (cs.zIndex !== "-10") continue;
    if (cs.position !== "fixed" && cs.position !== "absolute") continue;
    el.style.visibility = "hidden";
    n += 1;
  }
  return n;
});
await page.waitForTimeout(200);

const after = await page.screenshot();

const diff = await page.evaluate(
  async ({ a, b, c, scale }) => {
    const load = async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      return { data: c.getContext("2d").getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
    };
    const A = await load(a);
    const B = await load(b);
    const C = await load(c);
    // Pragul e cel din `a11y-audit.mjs` (24 pe suma canalelor): sub el sunt
    // artefacte de compresie/antialiasing, nu atmosferă.
    const PRAG = 24;
    const randuriSchimbate = (X, Y) => {
      const out = new Array(X.h).fill(0);
      for (let y = 0; y < X.h; y += 1) {
        let n = 0;
        for (let x = 0; x < X.w; x += 1) {
          const i = (y * X.w + x) * 4;
          const d =
            Math.abs(X.data[i] - Y.data[i]) +
            Math.abs(X.data[i + 1] - Y.data[i + 1]) +
            Math.abs(X.data[i + 2] - Y.data[i + 2]);
          if (d > PRAG) n += 1;
        }
        out[y] = n;
      }
      return out;
    };
    const cuAtmosfera = randuriSchimbate(A, B);
    const zgomot = randuriSchimbate(A, C);
    // Un rând contează ca „atins de atmosferă" doar dacă are destui pixeli
    // schimbați PESTE zgomotul măsurat pe același rând. Fără asta, o fotografie
    // sosită între cele două capturi ar trage raza până jos de tot.
    const MIN_PE_RAND = Math.max(8, Math.round(A.w * 0.02));
    let reach = -1;
    const perRand = new Array(A.h).fill(0);
    for (let y = 0; y < A.h; y += 1) {
      const net = Math.max(0, cuAtmosfera[y] - zgomot[y]);
      perRand[y] = net;
      if (net >= MIN_PE_RAND) reach = y;
    }
    return {
      reach: reach < 0 ? -1 : Math.round((reach + 1) / scale),
      randuri: perRand.map((n) => Math.round((n / A.w) * 100)),
      zgomotMax: Math.round((Math.max(...zgomot) / A.w) * 100),
      inaltime: Math.round(A.h / scale),
    };
  },
  {
    a: before.toString("base64"),
    b: after.toString("base64"),
    c: control.toString("base64"),
    scale: SCALE,
  },
);

const overlap = diff.reach < 0 ? 0 : diff.reach - listTop;
// Cât din listă stă peste atmosferă, în procente de rând — util ca să se vadă
// dacă e o muchie de un pixel sau un ecran întreg.
const subLista = diff.randuri
  .map((pct, y) => ({ y: Math.round(y / SCALE), pct }))
  .filter((r) => r.y >= listTop && r.pct >= 1);

console.log(`ecran        ${WIDTH}x${HEIGHT}  ${url}`);
console.log(`straturi     ${hidden} stins(e) (aria-hidden + z-index:-10) · zgomot de control max ${diff.zgomotMax}% dintr-un rând`);
console.log(`lista începe ${listTop}px  ("${selector}")`);
console.log(`atmosfera ajunge la ${diff.reach < 0 ? "— (niciun pixel)" : `${diff.reach}px`}`);
console.log(
  `SUPRAPUNERE  ${overlap > 0 ? `${overlap}px de listă peste atmosferă` : "0px — curat"}` +
    (subLista.length ? `  · ${subLista.length} rânduri atinse, max ${Math.max(...subLista.map((r) => r.pct))}% lățime` : ""),
);

await browser.close();
process.exit(overlap > 0 ? 1 : 0);
