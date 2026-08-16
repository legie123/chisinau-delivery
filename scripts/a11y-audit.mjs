// Accesibilitate măsurată pe ecranul viu: se vede focusul, și e degetul destul
// de mare? (rubrica §8 + criteriul V10: „focus vizibil, ținte de atingere ≥44px")
//
//   node scripts/a11y-audit.mjs <url>
//   SHOT_ROLE=curier SHOT_WIDTH=390 SHOT_HEIGHT=844 node scripts/a11y-audit.mjs <url>
//
// Ce NU face: nu citește CSS și nu are încredere în el. `outline: none` se vede
// din cod, dar un inel auriu care cade exact peste un fundal auriu nu — deci
// focusul se probează la fel ca textul (`text-contrast.mjs`): se fotografiază
// elementul, i se dă focus, se fotografiază din nou și se compară pixelii. Zero
// pixeli schimbați = focus invizibil, indiferent ce zice foaia de stil.
//
// Ținta de atingere se ia din dreptunghiul REAL randat (un buton de 44px cu
// `padding` zero rămâne 44px; unul de 20px cu `p-3` ajunge la 44 — de-aia se
// măsoară randarea, nu clasa). Excepția WCAG 2.5.8 pentru linkurile din
// interiorul unei fraze e aplicată explicit și numită, nu tăcută.

import { chromium } from "/Users/user/.npm/_npx/db89d7302a373f10/node_modules/playwright/index.mjs";

const [, , url] = process.argv;
if (!url) {
  console.error("utilizare: node scripts/a11y-audit.mjs <url>");
  process.exit(1);
}

const ROLE = process.env.SHOT_ROLE ?? "client";
const BASE = new URL(url).origin;
const WIDTH = Number(process.env.SHOT_WIDTH ?? 390);
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 844);
const TARGET_MIN = 44;
const CAP = Number(process.env.A11Y_CAP ?? 44);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(`${BASE}/master`, { waitUntil: "domcontentloaded" });
await context.request.post(`${BASE}/master/enter/${ROLE}`);
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
// Filmele se opresc: altfel diferența dintre „înainte de focus" și „după focus"
// prinde orașul care se mișcă în fundal în loc de inelul de focus.
await page.evaluate(() => document.querySelectorAll("video").forEach((v) => v.pause()));

// O APĂSARE REALĂ DE TAB, o singură dată, înainte de orice măsurătoare.
// `:focus-visible` (regula care desenează inelul, `globals.css`) nu se aprinde
// la un `el.focus()` din cod decât dacă browserul e deja în „modalitate
// tastatură". Fără Tab-ul ăsta, unealta raportează „focus invizibil" pentru
// elemente perfect corecte — adică exact minciuna pe care valul ăsta o vânează,
// doar că în propriul instrument.
await page.keyboard.press("Tab");
await page.evaluate(() => document.activeElement?.blur?.());

const SELECTOR =
  'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"], [tabindex]:not([tabindex="-1"])';

const inventory = await page.evaluate(
  ({ SELECTOR }) => {
    const seen = new Set();
    const out = [];
    document.querySelectorAll(SELECTOR).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 1 || r.height < 1) return;
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return;
      el.setAttribute("data-a11y-id", String(i));
      const label =
        (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 34) || `<${el.tagName.toLowerCase()}>`;
      // Excepția WCAG 2.5.8: un link în interiorul unei fraze n-are cum să fie
      // 44px fără să rupă rândul. Se numește, nu se ascunde.
      const inline =
        el.tagName === "A" &&
        cs.display.startsWith("inline") &&
        Boolean(el.parentElement && el.parentElement.textContent.trim().length > label.length + 8);
      const key = `${label}|${Math.round(r.width)}x${Math.round(r.height)}`;
      const dup = seen.has(key);
      seen.add(key);
      out.push({
        id: String(i),
        label,
        tag: el.tagName.toLowerCase(),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
        inline,
        dup,
      });
    });
    return out;
  },
  { SELECTOR },
);

// Un ecran cu ZERO elemente interactive nu e un ecran perfect, e un ecran care
// nu s-a încărcat. Fără garda asta unealta raportează „probleme: 0" cu litere
// verzi pentru o pagină albă — cea mai ieftină minciună posibilă.
if (inventory.length === 0) {
  console.error(`\n${url}: zero elemente interactive — pagina nu s-a încărcat (server picat, rol greșit sau redirect).`);
  await browser.close();
  process.exit(2);
}

const considered = inventory.slice(0, CAP);
const dropped = inventory.length - considered.length;

const results = [];
for (const item of considered) {
  // Focus ÎNTÂI, apoi blur, apoi măsurăm cutia. Motivul e o capcană plătită:
  // focusarea unui card dintr-o bandă cu derulare pe orizontală DERULEAZĂ banda,
  // deci cutia dinainte de focus nu mai e acolo după focus — cele două capturi
  // cădeau pe regiuni diferite și unealta raporta „focus invizibil" pentru un
  // inel auriu gros, vizibil cu ochiul liber în captură. După blur, poziția
  // rămâne cea nouă, deci ambele capturi se aliniază pe același loc.
  const box = await page.evaluate((id) => {
    const el = document.querySelector(`[data-a11y-id="${id}"]`);
    if (!el) return null;
    const pre = el.getBoundingClientRect();
    if (pre.top < 0 || pre.bottom > window.innerHeight) el.scrollIntoView({ block: "center", behavior: "instant" });
    el.focus?.();
    el.blur?.();
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, item.id);
  if (!box) continue;
  await page.waitForTimeout(160);

  // Marginea de 8px prinde și un inel desenat în AFARA cutiei (`outline-offset`).
  // Decupajul se INTERSECTEAZĂ cu ecranul — un element lipit sticky sau mai înalt
  // decât fereastra nu intră tot, iar Playwright refuză un decupaj din afara imaginii.
  const pad = 8;
  const x0 = Math.max(0, box.x - pad);
  const y0 = Math.max(0, box.y - pad);
  const x1 = Math.min(WIDTH, box.x + box.w + pad);
  const y1 = Math.min(HEIGHT, box.y + box.h + pad);
  if (x1 - x0 < 2 || y1 - y0 < 2) continue;
  const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };

  const before = await page.screenshot({ clip });
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-a11y-id="${id}"]`);
    // `:focus-visible` nu se aprinde la focus programatic în Chromium decât dacă
    // ultima interacțiune a fost de tastatură — deci se apasă Tab pe bune mai
    // jos; aici doar mutăm focusul pe elementul cerut.
    el?.focus?.();
  }, item.id);
  await page.waitForTimeout(140);
  const after = await page.screenshot({ clip });

  const diff = await page.evaluate(
    async ({ a, b }) => {
      const load = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        return c.getContext("2d").getImageData(0, 0, img.width, img.height).data;
      };
      const A = await load(a);
      const B = await load(b);
      const lum = (r, g, bl) => {
        const f = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
      };
      let changed = 0;
      let best = 1;
      const total = A.length / 4;
      for (let i = 0; i < A.length; i += 4) {
        const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (d <= 24) continue;
        changed += 1;
        // Contrastul indicatorului = cât de tare se desprinde pixelul aprins de
        // ce era acolo înainte (WCAG 2.4.13 cere ≥3:1 față de vecinătate).
        const l1 = lum(B[i], B[i + 1], B[i + 2]);
        const l0 = lum(A[i], A[i + 1], A[i + 2]);
        const ratio = (Math.max(l0, l1) + 0.05) / (Math.min(l0, l1) + 0.05);
        if (ratio > best) best = ratio;
      }
      return { pct: +((changed / total) * 100).toFixed(2), best: +best.toFixed(2) };
    },
    { a: before.toString("base64"), b: after.toString("base64") },
  );

  results.push({ ...item, focusPct: diff.pct, focusContrast: diff.best });
  await page.evaluate(() => document.activeElement?.blur?.());
}

// Două praguri, nu unul. 24×24 e minimul OBLIGATORIU (WCAG 2.5.8, nivel AA);
// 44 e ținta rubricii (§8, nivelul AAA 2.5.5). Un control de 28px nu e „la fel
// de stricat" ca unul de 12px, iar dacă unealta le pune în aceeași grămadă,
// valul următor fie repară ce era deja conform, fie ignoră ce chiar pică.
const FAIL_AA = 24;
const small = results.filter((r) => Math.min(r.w, r.h) < TARGET_MIN && !r.inline);
const failAA = small.filter((r) => Math.min(r.w, r.h) < FAIL_AA);
const belowGoal = small.filter((r) => Math.min(r.w, r.h) >= FAIL_AA);
const noFocus = results.filter((r) => r.focusPct < 0.5);
const weakFocus = results.filter((r) => r.focusPct >= 0.5 && r.focusContrast < 3);

console.log(`\n== ${url}  ${WIDTH}×${HEIGHT}  rol=${ROLE} ==`);
console.log(`elemente interactive vizibile: ${inventory.length}${dropped ? ` (măsurate ${considered.length}, SĂRITE ${dropped} — ridică A11Y_CAP)` : ""}`);

console.log(`\n-- ȚINTE care pică minimul AA de ${FAIL_AA}px (${failAA.length}) --`);
for (const r of failAA) console.log(`  ${String(r.w).padStart(6)}×${String(r.h).padEnd(6)} ${r.tag.padEnd(7)} ${r.label}`);
if (!failAA.length) console.log("  niciuna");

console.log(`\n-- trec AA, sub ținta de ${TARGET_MIN}px a rubricii (${belowGoal.length}) --`);
for (const r of belowGoal) console.log(`  ${String(r.w).padStart(6)}×${String(r.h).padEnd(6)} ${r.tag.padEnd(7)} ${r.label}`);
if (!belowGoal.length) console.log("  niciuna");

console.log(`\n-- focus INVIZIBIL (${noFocus.length}) --`);
for (const r of noFocus) console.log(`  ${String(r.focusPct).padStart(6)}% schimbat  ${r.tag.padEnd(7)} ${r.label}`);
if (!noFocus.length) console.log("  niciunul");

console.log(`\n-- focus vizibil dar slab, sub 3:1 (${weakFocus.length}) --`);
for (const r of weakFocus)
  console.log(`  ${String(r.focusContrast).padStart(6)}:1  ${String(r.focusPct).padStart(6)}% ${r.tag.padEnd(7)} ${r.label}`);
if (!weakFocus.length) console.log("  niciunul");

if (process.env.A11Y_ALL === "1") {
  console.log(`\n-- toate elementele (proba că unealta chiar vede focusul) --`);
  for (const r of results)
    console.log(
      `  ${String(r.focusPct).padStart(6)}% ${String(r.focusContrast).padStart(6)}:1  ${String(r.w).padStart(6)}×${String(r.h).padEnd(6)} ${r.tag.padEnd(7)} ${r.label}`,
    );
}

const inlineExempt = results.filter((r) => Math.min(r.w, r.h) < TARGET_MIN && r.inline);
if (inlineExempt.length) console.log(`\n(${inlineExempt.length} linkuri în frază, exceptate WCAG 2.5.8 — numite, nu ascunse)`);

const bad = small.length + noFocus.length + weakFocus.length;
console.log(`\nprobleme: ${bad}`);
await browser.close();
process.exit(bad > 0 ? 1 : 0);
