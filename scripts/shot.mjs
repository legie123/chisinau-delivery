// Capturi de verificare pentru bucla de design (docs/LOOP-NOAPTE.md).
// Nu e parte din build — o unealtă de probă: deschide ecranele reale pe
// serverul local, la telefon (390×844) și desktop (1440×900), și salvează PNG-uri
// care se DESCHID și se privesc. Un build verde nu e dovadă de UX.
//
//   node scripts/shot.mjs <dir-ieșire> <nume|cale|lățime|înălțime|rol?|full?> ...
//
// rol: client | curier | restaurant | platform (intră prin poarta /master, care
// în dezvoltare nu cere parolă). Gol = vizitator neautentificat.

import { chromium } from "/Users/user/.npm/_npx/db89d7302a373f10/node_modules/playwright/index.mjs";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3007";
const [, , outDir, ...specs] = process.argv;

const browser = await chromium.launch();

for (const spec of specs) {
  const [name, path, w, h, role, full] = spec.split("|");
  const context = await browser.newContext({
    viewport: { width: +w, height: +h },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  if (role) {
    // Poarta master semnează server-side cu contul de sămânță al rolului.
    await page.goto(`${BASE}/master`, { waitUntil: "domcontentloaded" });
    await context.request.post(`${BASE}/master/enter/${role}`);
  }

  try {
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
  } catch {
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(1500);

  const out = `${outDir}/${name}-${w}x${h}.png`;
  await page.screenshot({ path: out, fullPage: full === "full" });
  console.log(`shot ${out}  ${(await page.title()).slice(0, 55)}`);
  await context.close();
}

await browser.close();
