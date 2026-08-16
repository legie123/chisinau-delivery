// Cât costă atmosfera pe un ecran de LUCRU — în cadre, nu în păreri.
//
// Rubrica (`docs/DESIGN-IMERSIV-4-SECTOARE.md` §4) cere explicit pentru sectorul
// restaurant: „în panoul operațional exclusiv `ambient`, la 5%, sau chiar
// gradient static DACĂ MĂSURĂTOAREA ARATĂ că video-ul fură cadre pe tabletele
// lor". Deci decizia nu se ia din gust; se ia din cifra de mai jos.
//
//   node scripts/frame-cost.mjs <cale> <rol> <video> [--cpu N] [--secunde N]
//   node scripts/frame-cost.mjs /restaurant/orders restaurant /videos/hero-flame.mp4 --cpu 4
//
// Metoda, în trei părți, ca să nu se poată confunda o pagină lentă cu un video scump:
//   1. se măsoară pagina AȘA CUM E (fără video)  — linia de bază
//   2. se injectează EXACT stratul pe care l-ar randa `SectorBackdrop` la
//      `ambient` (același `src`, `object-cover`, aceeași opacitate, aceeași
//      derivă), se așteaptă să curgă, se măsoară din nou
//   3. se scoate stratul și se măsoară a treia oară — dacă linia de bază nu
//      revine, măsurătoarea a prins altceva (încărcare de pagină, GC) și nu se
//      raportează ca fiind costul video-ului
//
// `--cpu N` încetinește procesorul de N ori (CDP `Emulation.setCPUThrottlingRate`).
// Tableta de tejghea a unui restaurant nu e laptopul pe care se scrie codul:
// măsurat la 1× totul e gratis, ceea ce e exact felul în care se ratează defectul.
//
// Cadrele se numără cu `requestAnimationFrame`; sarcinile lungi (>50 ms, adică
// exact cât ține un buton să nu răspundă la atingere) cu `PerformanceObserver`.

import { chromium } from "/Users/user/.npm/_npx/db89d7302a373f10/node_modules/playwright/index.mjs";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3007";
const [, , path, role, video, ...rest] = process.argv;
if (!path || !video) {
  console.error("utilizare: node scripts/frame-cost.mjs <cale> <rol> <video> [--cpu N] [--secunde N]");
  process.exit(1);
}
const arg = (name, fallback) => {
  const i = rest.indexOf(name);
  return i === -1 ? fallback : Number(rest[i + 1]);
};
const CPU = arg("--cpu", 4);
const SECONDS = arg("--secunde", 6);
const WIDTH = Number(process.env.SHOT_WIDTH ?? 1024); // tabletă de tejghea
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 768);
const OPACITY = Number(process.env.AMBIENT_OPACITY ?? 0.05); // rubrica §4
const DRIFT = Number(process.env.AMBIENT_DRIFT ?? 1.06);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
const page = await context.newPage();

if (role) {
  await page.goto(`${BASE}/master`, { waitUntil: "domcontentloaded" });
  await context.request.post(`${BASE}/master/enter/${role}`);
}
await page.goto(BASE + path, { waitUntil: "networkidle" });

const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

/** Numără cadrele reale + sarcinile lungi într-o fereastră de `ms`. */
async function sample(ms) {
  return page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        let frames = 0;
        let long = 0;
        let longest = 0;
        let po;
        try {
          po = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              long += 1;
              longest = Math.max(longest, e.duration);
            }
          });
          po.observe({ entryTypes: ["longtask"] });
        } catch {
          /* Safari/Firefox n-au longtask — cadrele rămân măsurabile */
        }
        const t0 = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else {
            po?.disconnect();
            const elapsed = performance.now() - t0;
            resolve({ fps: +((frames / elapsed) * 1000).toFixed(1), long, longest: Math.round(longest) });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

/** Stratul pe care `SectorBackdrop` îl randează la `ambient` — nimic altceva. */
async function mountVideo(src, opacity, drift) {
  await page.evaluate(
    async ({ src, opacity, drift }) => {
      const box = document.createElement("div");
      box.id = "frame-cost-probe";
      box.setAttribute("aria-hidden", "true");
      box.style.cssText = "position:fixed;inset:0;z-index:-10;overflow:hidden;pointer-events:none";
      const v = document.createElement("video");
      v.src = src;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.autoplay = true;
      v.className = "ambient-drift";
      v.style.cssText = `position:absolute;inset:0;height:100%;width:100%;object-fit:cover;opacity:${opacity}`;
      v.style.setProperty("--drift-to", String(drift));
      box.appendChild(v);
      document.body.appendChild(box);
      await v.play().catch(() => {});
      // Se așteaptă să CURGĂ, nu doar să existe: un video oprit nu costă nimic
      // și ar produce exact verdictul comod „nu fură cadre".
      const t0 = performance.now();
      while (v.currentTime < 0.4 && performance.now() - t0 < 8000) {
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    { src, opacity, drift },
  );
}

const bytes = await page.evaluate(async (src) => {
  const r = await fetch(src, { method: "HEAD" });
  return Number(r.headers.get("content-length") ?? 0);
}, video);

await sample(1500); // încălzire: primul rAF după navigare e mereu cel mai prost
const before = await sample(SECONDS * 1000);
await mountVideo(video, OPACITY, DRIFT);
const during = await sample(SECONDS * 1000);
await page.evaluate(() => document.getElementById("frame-cost-probe")?.remove());
await sample(800);
const after = await sample(SECONDS * 1000);

const drop = +(((before.fps - during.fps) / before.fps) * 100).toFixed(1);
// Dacă pagina nu-și revine după ce scoatem video-ul, cifra „during" nu descrie
// video-ul, ci altceva. Se spune, nu se ascunde.
const recovered = after.fps >= before.fps * 0.95;

console.log(`\n${path}  ·  ${video}  ·  ${WIDTH}×${HEIGHT}  ·  CPU ÷${CPU}  ·  ${SECONDS}s per probă`);
console.table([
  { probă: "1. fără video (bază)", fps: before.fps, "sarcini >50ms": before.long, "cea mai lungă (ms)": before.longest },
  { probă: `2. cu video @${OPACITY}`, fps: during.fps, "sarcini >50ms": during.long, "cea mai lungă (ms)": during.longest },
  { probă: "3. după scoatere", fps: after.fps, "sarcini >50ms": after.long, "cea mai lungă (ms)": after.longest },
]);
console.log(`greutate asset: ${(bytes / 1048576).toFixed(2)} MB (buget §3: 1.50 MB)`);
console.log(`pierdere de cadre: ${drop}%`);
console.log(`revenire după scoatere: ${recovered ? "da — cifra descrie video-ul" : "NU — măsurătoarea a prins altceva, nu o raporta"}`);
console.log(
  drop >= 10
    ? "\nVERDICT: video-ul FURĂ cadre pe tableta de tejghea ⇒ §4 cere gradient static în panou."
    : "\nVERDICT: sub pragul de 10% ⇒ `ambient` la 5% e admisibil în panou.",
);

await browser.close();
