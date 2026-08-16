// Cât de întunecat trebuie voalul ca textul să se citească peste un video.
// Unealtă de probă pentru rubrica vizuală (docs/DESIGN-IMERSIV-4-SECTOARE.md §1:
// „contrast minim 4.5:1 — cu un strat de întunecare între ele, nu cu noroc").
//
//   node scripts/veil-contrast.mjs [poster.jpg ...]     (implicit: toate posterele)
//
// Măsoară pe POSTER, care e un cadru real din video, nu pe intuiție. Zona
// măsurată e banda din mijloc (25%-75% pe verticală), acolo unde stă textul de
// hero. Raportează pe percentila 95 a luminanței — pixelul aprins (flacără,
// lampă) decide lizibilitatea, nu media. Lecția plătită în V1: un voal calibrat
// pe medie cade exact pe fotografia cea mai deschisă.
import { chromium } from "/Users/user/.npm/_npx/db89d7302a373f10/node_modules/playwright/index.mjs";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const VEIL = [10, 10, 20]; // #0a0a14 — substratul navy al aplicației
const dir = resolve("public/videos");
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => f.endsWith("-poster.jpg")).map((f) => `${dir}/${f}`);

const browser = await chromium.launch();
const page = await browser.newPage();

const rows = [];
for (const file of files) {
  const p95 = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = Math.round((img.height / img.width) * 240);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const top = Math.round(c.height * 0.25);
    const band = ctx.getImageData(0, top, c.width, Math.round(c.height * 0.5)).data;
    const px = [];
    for (let i = 0; i < band.length; i += 4) px.push([band[i], band[i + 1], band[i + 2]]);
    const lin = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    const lum = px.map(([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b));
    lum.sort((a, b) => a - b);
    const idx = Math.floor(lum.length * 0.95);
    // întoarce pixelul de la percentila 95, în sRGB, ca să-l putem compune cu voalul
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < px.length; i++) {
      const [r, g, b] = px[i];
      const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const d = Math.abs(l - lum[idx]);
      if (d < bestDiff) { bestDiff = d; best = i; }
    }
    return px[best];
  }, `data:image/jpeg;base64,${(await import("node:fs")).readFileSync(file).toString("base64")}`);

  const lin = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const lumOf = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const over = (bg, alpha) => bg.map((c, i) => alpha * VEIL[i] + (1 - alpha) * c);
  const ratio = (fg, bg) => {
    const [a, b] = [lumOf(fg) + 0.05, lumOf(bg) + 0.05].sort((x, y) => y - x);
    return a / b;
  };
  // Textul REAL de pe ecranele de hero, de la cel mai slab la cel mai tare:
  // punctele din listă `text-white/60`, subtitlul `text-white/70`, eticheta
  // `text-gold/80`. Titlul e alb plin, deci nu el decide niciodată podeaua.
  const GOLD = [245, 166, 35];
  const white = (a) => (bg) => bg.map((c) => a * 255 + (1 - a) * c);
  const gold = (a) => (bg) => bg.map((c, i) => a * GOLD[i] + (1 - a) * c);
  const TEXTS = {
    "alb/60": white(0.6),
    "alb/70": white(0.7),
    "auriu/80": gold(0.8),
  };
  const blend70 = white(0.7);

  const need = (target, textFn) => {
    for (let a = 0; a <= 100; a++) {
      const bg = over(p95, a / 100);
      if (ratio(textFn(bg), bg) >= target) return a / 100;
    }
    return null;
  };

  // Voalul aplicat de SectorBackdrop: strat plat + banda de citire din mijloc,
  // compuse (1-(1-a)(1-b)) — vezi src/components/immersive/sectors.ts.
  const at = (a, textFn) => {
    const bg = over(p95, a);
    return ratio(textFn(bg), bg).toFixed(2);
  };
  // Podeaua sectorului = cel mai slab text de pe ecran, nu media lor.
  const cerinte = Object.fromEntries(
    Object.entries(TEXTS).map(([nume, fn]) => [nume, need(4.5, fn)]),
  );
  const floor = Math.max(...Object.values(cerinte).map((v) => v ?? 1));
  const slabul = Object.entries(cerinte).find(([, v]) => v === floor)?.[0];

  rows.push({
    poster: file.split("/").pop(),
    p95: `rgb(${p95.map(Math.round).join(",")})`,
    ...cerinte,
    "PODEA (cel mai slab)": `${floor} (${slabul})`,
    "azi @0.35": at(0.35, blend70),
    "@podea": at(floor, blend70),
  });
}

console.table(rows);
await browser.close();
