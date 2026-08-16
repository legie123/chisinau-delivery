// Contrastul REAL al textului de pe un ecran viu, măsurat pe pixeli.
// Frate cu `scripts/veil-contrast.mjs` (care măsoară posterul unui sector);
// ăsta măsoară textul deja randat, peste orice stă sub el — gradient de card,
// fotografie, voal, toate compuse de browser.
//
// De ce nu se citește din CSS: culorile produsului sunt scrise cu alfa
// (`text-white/55`), iar fundalul cardurilor e un `linear-gradient`. Un calcul
// din `getComputedStyle` întoarce „transparent" pentru fundal și minte cu
// ordine de mărime — greșeala plătită în V7, prinsă fiindcă a raportat 1.03:1
// pentru un text vizibil cu ochiul liber.
//
//   node scripts/text-contrast.mjs <url> "<selector>|<eticheta>" ...
//
// Metoda: se decupează dreptunghiul textului din captură, se ia percentila 95 a
// luminanței (miezul literei, nu marginea antialiasată) ca text și mediana ca
// fundal. Pragul rubricii (§8): 4.5:1.

import { chromium } from "/Users/user/.npm/_npx/db89d7302a373f10/node_modules/playwright/index.mjs";

const [, , url, ...specs] = process.argv;
if (!url || specs.length === 0) {
  console.error('utilizare: node scripts/text-contrast.mjs <url> "<selector>|<eticheta>" ...');
  process.exit(1);
}

const ROLE = process.env.SHOT_ROLE ?? "client";
const BASE = new URL(url).origin;
const WIDTH = Number(process.env.SHOT_WIDTH ?? 390);
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 844);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(`${BASE}/master`, { waitUntil: "domcontentloaded" });
await context.request.post(`${BASE}/master/enter/${ROLE}`);
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const shot = (await page.screenshot({ fullPage: true })).toString("base64");

const results = await page.evaluate(
  async ({ shot, specs }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${shot}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    // Captura e fullPage la deviceScaleFactor 2 — raportul dintre pixelii ei și
    // coordonatele CSS se ia din lățime, nu se presupune.
    const scale = img.width / document.documentElement.clientWidth;

    const lum = (r, g, b) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };

    const out = [];
    for (const spec of specs) {
      const [selector, label] = spec.split("|");
      const el = document.querySelector(selector);
      if (!el) {
        out.push({ label, error: "lipsește pe ecran" });
        continue;
      }
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const x = Math.round((r.left + window.scrollX) * scale);
      const y = Math.round((r.top + window.scrollY) * scale);
      const w = Math.max(1, Math.round(r.width * scale));
      const h = Math.max(1, Math.round(r.height * scale));
      const data = ctx.getImageData(x, y, w, h).data;
      const ls = [];
      for (let i = 0; i < data.length; i += 4) ls.push(lum(data[i], data[i + 1], data[i + 2]));
      ls.sort((a, b) => a - b);
      const at = (q) => ls[Math.min(ls.length - 1, Math.max(0, Math.floor(ls.length * q)))];
      const text = at(0.95);
      const bg = at(0.5);
      const ratio = (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05);
      out.push({
        label,
        ratio: +ratio.toFixed(2),
        size: getComputedStyle(el).fontSize,
        sample: (el.textContent ?? "").trim().slice(0, 34),
      });
    }
    return out;
  },
  { shot, specs },
);

let worst = 99;
for (const r of results) {
  if (r.error) {
    console.log(`   ??? | ${r.label} — ${r.error}`);
    continue;
  }
  worst = Math.min(worst, r.ratio);
  const verdict = r.ratio >= 4.5 ? "ok " : "SUB";
  console.log(`${String(r.ratio).padStart(6)} ${verdict} | ${r.label.padEnd(22)} | ${r.size.padEnd(6)} | ${r.sample}`);
}
console.log(`\ncel mai slab: ${worst.toFixed(2)}:1 (prag rubrică §8: 4.5:1)`);

await browser.close();
