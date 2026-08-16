// Contrastul REAL al textului de pe un ecran viu, măsurat pe pixeli.
// Frate cu `scripts/veil-contrast.mjs` (care măsoară posterul unui sector);
// ăsta măsoară textul deja randat, peste orice stă sub el — gradient de card,
// fotografie, voal, toate compuse de browser.
//
//   node scripts/text-contrast.mjs <url> "<selector>|<eticheta>" ...
//
// METODA: diferență de glife, nu percentile.
// Se fac DOUĂ capturi ale aceluiași ecran: una normală și una în care glifele
// elementului sunt stinse (`color: transparent`), placa lui rămânând pe loc.
// Pixelii care se schimbă între ele SUNT literele — deci textul se măsoară din
// prima captură exact acolo unde e cerneală, iar fundalul din a doua exact sub
// aceleași litere. Nimic nu se ghicește.
//
// De ce nu percentila 95 pe dreptunghi (versiunea de până acum): un titlu scurt
// într-un bloc lat ocupă sub 5% din dreptunghi, deci percentila cădea tot pe
// fundal și raporta 2.08:1 pentru un `h2` alb perfect lizibil (V6, issues.md).
// De ce nu `getComputedStyle`: culorile au alfa și cardurile au `linear-gradient`
// — întoarce „transparent" și minte cu un ordin de mărime (V7, 1.03:1).
//
// Praguri: rubrica §8 cere 4.5:1 pentru ORICE text peste video sau gradient.
//
// AL DOILEA CAPĂT AL ACELEIAȘI LECȚII: un fundal care se MIȘCĂ n-are un singur
// contrast. Aceeași etichetă de pe `/concierge` dă 7.46:1 pe cadrul de la 1.73s
// și 2.81:1 două secunde mai târziu, când se aprinde lampa exact sub ea. Deci
// filmele se baleiază (`TC_SWEEP`, implicit 6 cadre egal distanțate) și se
// raportează CADRUL CEL MAI RĂU, nu cel nimerit. Fără asta, unealta ar semna un
// ecran care pică singur după o secundă.
//
// Variabile: SHOT_ROLE, SHOT_WIDTH, SHOT_HEIGHT, TC_ALL=1 (măsoară toate
// potrivirile selectorului și raportează CEA MAI SLABĂ — cardul cel mai deschis
// decide, nu primul din listă), TC_SWEEP=<n> cadre baleiate din film.

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
const ALL = process.env.TC_ALL === "1";
const SWEEP = Number(process.env.TC_SWEEP ?? 6);
const THRESHOLD = 4.5;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(`${BASE}/master`, { waitUntil: "domcontentloaded" });
await context.request.post(`${BASE}/master/enter/${ROLE}`);
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// Filmele de fundal se opresc ÎNAINTE de orice măsurătoare: altfel cele două
// capturi diferă prin cadrul video, iar masca de glife ar prinde orașul care se
// mișcă în loc de literele care stau.
const videoCount = await page.evaluate(() => {
  const vs = [...document.querySelectorAll("video")];
  vs.forEach((v) => v.pause());
  return vs.length;
});

/** Mută toate filmele la fracțiunea f din durata lor și așteaptă cadrul pictat. */
const seekVideos = async (f) => {
  if (!videoCount) return null;
  const t = await page.evaluate(async (f) => {
    const vs = [...document.querySelectorAll("video")];
    await Promise.all(
      vs.map(
        (v) =>
          new Promise((resolve) => {
            if (!Number.isFinite(v.duration) || v.duration <= 0) return resolve();
            const target = Math.min(f * v.duration, v.duration - 0.05);
            if (Math.abs(v.currentTime - target) < 0.02) return resolve();
            v.addEventListener("seeked", () => resolve(), { once: true });
            v.currentTime = target;
            setTimeout(resolve, 900);
          }),
      ),
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return vs.map((v) => +(v.currentTime ?? 0).toFixed(2));
  }, f);
  await page.waitForTimeout(90);
  return t;
};

const FRAMES = videoCount ? [...Array(Math.max(1, SWEEP)).keys()].map((i) => i / Math.max(1, SWEEP)) : [0];

// Două comutatoare separate, și separarea lor E lecția: stingerea glifelor și
// stingerea umbrei nu au voie să se întâmple în aceeași captură.
//
// Dacă scoți umbra DOAR în captura B (varianta evidentă), masca de diferență
// include halo-ul negru al umbrei; peste un fundal luminos mediana pixelilor
// schimbați cade SUB fundal, unealta apucă capătul întunecat și raportează
// umbră-vs-flacără: 1,53:1 pentru un text perfect lizibil. Dacă păstrezi umbra
// în ambele, măsori litera vs propria ei umbră: 18,08:1, la fel de fals, doar
// flatant. (Cifrele sunt ale muncitorului V8, pe `.photo-caption` de pe
// `/start/restaurant`, cadrul cel mai luminos al flăcării.)
//
// Deci umbra se scoate din PAGINĂ, în AMBELE capturi — atunci numărul spune ce
// face voalul singur, care e singurul lucru pe care îl poți repara din contract.
// Pentru textul care chiar are umbră se raportează și a doua cifră, „cu plasa",
// ca să se vadă cât ține plasa și cât ține fundalul.
await page.addStyleTag({
  content: `
    [data-tc-hide], [data-tc-hide] * {
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      text-decoration-color: transparent !important;
    }
    [data-tc-noshadow], [data-tc-noshadow] * { text-shadow: none !important; }
  `,
});

const lum = (r, g, b) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** Câte elemente potrivesc fiecare selector (ca să știm dacă măsurăm 1 sau N). */
const counts = await page.evaluate(
  (specs) =>
    specs.map((spec) => {
      const [selector] = spec.split("|");
      try {
        return document.querySelectorAll(selector).length;
      } catch {
        return -1;
      }
    }),
  specs,
);

const results = [];

for (let s = 0; s < specs.length; s += 1) {
  const [selector, label] = specs[s].split("|");
  const total = counts[s];
  if (total === -1) {
    results.push({ label, error: "selector invalid" });
    continue;
  }
  if (total === 0) {
    results.push({ label, error: "lipsește pe ecran" });
    continue;
  }
  const indices = ALL ? [...Array(Math.min(total, 12)).keys()] : [0];
  let worstForSpec = null;

  for (const idx of indices) {
    // Elementul intră în ecran; capturile sunt pe VIEWPORT, nu fullPage, fiindcă
    // o captură fullPage randează fundalurile `fixed` o singură dată, sus — deci
    // orice text de sub prima pagină ar fi măsurat peste un fundal inexistent.
    const box = await page.evaluate(
      ({ selector, idx }) => {
        const el = document.querySelectorAll(selector)[idx];
        if (!el) return null;
        // NU se derulează un element deja vizibil. Capcană plătită aici: nivelul
        // `hero` al fundalului se RETRAGE la scroll (reparația din V3), deci un
        // `scrollIntoView` pe subtitlul din antet stingea exact atmosfera pe care
        // veneam s-o măsurăm — 7.13:1 peste substrat curat în loc de contrastul
        // real peste film. Unealta trebuie să fotografieze ecranul omului, nu
        // unul pe care l-a mișcat ea.
        const pre = el.getBoundingClientRect();
        if (pre.top < 0 || pre.bottom > window.innerHeight) {
          el.scrollIntoView({ block: "center", behavior: "instant" });
        }
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
          size: cs.fontSize,
          weight: cs.fontWeight,
          hasShadow: cs.textShadow !== "none" && cs.textShadow !== "",
          sample: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30),
        };
      },
      { selector, idx },
    );
    if (!box || box.w < 1 || box.h < 1) continue;
    await page.waitForTimeout(120);

    // Decupajul se intersectează cu ecranul: un element mai înalt decât fereastra
    // (sau lipit sticky sub ea) ar cere lui Playwright o zonă din afara imaginii.
    const x0 = Math.max(0, box.x);
    const y0 = Math.max(0, box.y);
    const x1 = Math.min(WIDTH, box.x + box.w);
    const y1 = Math.min(HEIGHT, box.y + box.h);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };

    // Baleiajul: același text, măsurat peste fiecare cadru al filmului. Rămâne
    // cel mai rău — ăla e ecranul pe care îl vede omul în secunda proastă.
    for (const f of FRAMES) {
    const frameTimes = await seekVideos(f);

    const flag = async (name, on) =>
      page.evaluate(
        ({ selector, idx, name, on }) => {
          const el = document.querySelectorAll(selector)[idx];
          if (!el) return;
          if (on) el.setAttribute(name, "");
          else el.removeAttribute(name);
        },
        { selector, idx, name, on },
      );

    /** O pereche de capturi (cu text / fără text) la starea curentă a umbrei. */
    const shoot = async () => {
      const a = await page.screenshot({ clip });
      await flag("data-tc-hide", true);
      const b = await page.screenshot({ clip });
      await flag("data-tc-hide", false);
      return { a, b };
    };

    // Cifra principală: fără umbră în NICIUNA din capturi ⇒ ce face voalul singur.
    await flag("data-tc-noshadow", true);
    const { a: withText, b: withoutText } = await shoot();
    await flag("data-tc-noshadow", false);

    const analyze = ({ a, b }) =>
      page.evaluate(
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
        const diffs = [];
        for (let i = 0; i < A.length; i += 4) {
          const d =
            Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
          if (d > 24) diffs.push([i, d]);
        }
        if (diffs.length === 0) return { pixels: 0 };
        // Miezul glifei = pixelii cu diferența cea mai mare; marginea
        // antialiasată e amestec de literă și fundal și ar dilua ambele capete.
        diffs.sort((p, q) => q[1] - p[1]);
        const core = diffs.slice(0, Math.max(1, Math.round(diffs.length * 0.35)));
        const px = (arr, i) => [arr[i], arr[i + 1], arr[i + 2]];
        return {
          pixels: diffs.length,
          text: core.map(([i]) => px(A, i)),
          bg: core.map(([i]) => px(B, i)),
        };
      },
        { a: a.toString("base64"), b: b.toString("base64") },
      );

    const measured = await analyze({ a: withText, b: withoutText });

    if (!measured.pixels) {
      results.push({ label, error: "zero glife detectate (text invizibil sau ascuns?)" });
      break;
    }

    const med = (rows) => {
      const ls = rows.map(([r, g, bl]) => lum(r, g, bl)).sort((x, y) => x - y);
      return ls[Math.floor(ls.length / 2)];
    };
    const ratioOf = (m) => {
      const t = med(m.text);
      const g = med(m.bg);
      return { ratio: (Math.max(t, g) + 0.05) / (Math.min(t, g) + 0.05), t, g };
    };
    const { ratio, t: text, g: bg } = ratioOf(measured);

    // A doua cifră, doar pentru textul care CHIAR are umbră: cât ține plasa.
    let netRatio = null;
    if (box.hasShadow) {
      const pair = await shoot();
      const m2 = await analyze(pair);
      if (m2.pixels) netRatio = +ratioOf(m2).ratio.toFixed(2);
    }
    const row = {
      label: total > 1 && ALL ? `${label} #${idx + 1}` : label,
      ratio: +ratio.toFixed(2),
      size: box.size,
      weight: box.weight,
      pixels: measured.pixels,
      sample: box.sample,
      frame: frameTimes ? frameTimes[0] : null,
      lumText: +text.toFixed(4),
      lumBg: +bg.toFixed(4),
      netRatio,
    };
    if (!worstForSpec || row.ratio < worstForSpec.ratio) worstForSpec = row;
    }
  }

  if (worstForSpec) {
    if (ALL && total > 1) worstForSpec.note = `cel mai slab din ${Math.min(total, 12)}`;
    results.push(worstForSpec);
  }
}

let worst = 99;
let failures = 0;
for (const r of results) {
  if (r.error) {
    console.log(`   ??? | ${r.label} — ${r.error}`);
    continue;
  }
  worst = Math.min(worst, r.ratio);
  if (r.ratio < THRESHOLD) failures += 1;
  const verdict = r.ratio >= THRESHOLD ? "ok " : "SUB";
  const at = r.frame === null ? "" : ` @${r.frame}s`;
  const net = r.netRatio === null || r.netRatio === undefined ? "" : ` (cu plasa ${r.netRatio}:1)`;
  if (process.env.TC_DEBUG === "1") console.log(`        (literă ${r.lumText} · fundal ${r.lumBg})`);
  console.log(
    `${String(r.ratio).padStart(6)} ${verdict} | ${r.label.padEnd(24)} | ${r.size.padEnd(6)} ${String(r.weight).padEnd(4)} | ${String(r.pixels).padStart(5)}px${at} | ${r.sample}${net}${r.note ? ` (${r.note})` : ""}`,
  );
}
console.log(
  `\ncel mai slab: ${worst === 99 ? "n/a" : `${worst.toFixed(2)}:1`} · sub prag: ${failures} · prag §8: ${THRESHOLD}:1` +
    (videoCount ? ` · ${FRAMES.length} cadre baleiate din film (se raportează cel mai rău)` : ""),
);

await browser.close();
process.exit(failures > 0 ? 1 : 0);
