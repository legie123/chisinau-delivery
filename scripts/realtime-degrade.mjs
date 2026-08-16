// Probă că o pagină „live" spune adevărul când legătura live moare.
//
// Nu e parte din build — o unealtă de dovadă, în aceeași familie cu
// `scripts/shot.mjs`. Diferența e că aici nu se fotografiază o pagină liniștită,
// ci una căreia i se TAIE rețeaua: `context.setOffline(true)` omoară websocket-ul
// exact ca un lift, un tunel sau un Wi-Fi de restaurant, iar apoi se verifică
// două lucruri pe care un test unitar nu le poate atinge — că banda chiar apare
// pe ecran, și că dispare singură când legătura revine.
//
//   node scripts/realtime-degrade.mjs <dir-ieșire> <bază> \
//        '<nume>|<cale>|<email>|<lățime>|<înălțime>'
//
// Parola conturilor de sămânță e `parola123` (vezi CLAUDE.md).
// Ieșire: PNG înainte/după + un verdict pe stdout pentru fiecare țintă.

import { chromium } from "/Users/user/.npm/_npx/db89d7302a373f10/node_modules/playwright/index.mjs";

const [, , outDir, base, ...specs] = process.argv;
const PASSWORD = "parola123";
// Cât așteptăm banda după tăiere. Phoenix (transportul Realtime) are heartbeat,
// deci detectarea nu e instantanee; 45s acoperă și cazul lent, fără să atârne.
const BAND_TIMEOUT = 45_000;

const browser = await chromium.launch();
let failures = 0;

for (const spec of specs) {
  const [name, path, email, w, h] = spec.split("|");
  const context = await browser.newContext({
    viewport: { width: +w, height: +h },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Autentificare REALĂ, prin formularul din produs — nu prin poarta /master,
  // fiindcă ecranele astea sunt legate de un anume om prin RLS, iar contul de
  // sămânță al rolului nu vede comanda altcuiva. Enter, nu click: un click
  // sintetic pe submit nu declanșează formularul React (lecție 2026-08-07).
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.press('input[type="password"]', "Enter");
  await page.waitForTimeout(3000);

  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  const band = page.locator('[role="status"]', { hasText: /Reconectare/i });

  const beforeCount = await band.count();
  await page.screenshot({ path: `${outDir}/${name}-legatura-vie-${w}x${h}.png` });

  // TĂIEREA. De aici încolo pagina nu mai are rețea deloc: websocket-ul cade,
  // iar poll-ul de recuperare eșuează — adică fix scenariul în care ecranul ar
  // rămâne pe date vechi dacă nu ar spune nimic.
  await context.setOffline(true);

  let appeared = false;
  try {
    await band.first().waitFor({ state: "visible", timeout: BAND_TIMEOUT });
    appeared = true;
  } catch {
    appeared = false;
  }
  await page.screenshot({ path: `${outDir}/${name}-legatura-taiata-${w}x${h}.png` });
  const bandText = appeared ? (await band.first().innerText()).replace(/\s+/g, " ").trim() : "";

  // REVENIREA. Fără proba asta, o bandă care rămâne lipită pe ecran după ce
  // rețeaua s-a întors ar fi tot o etichetă care minte, doar în celălalt sens.
  await context.setOffline(false);
  let cleared = false;
  try {
    await band.first().waitFor({ state: "hidden", timeout: BAND_TIMEOUT });
    cleared = true;
  } catch {
    cleared = false;
  }
  await page.screenshot({ path: `${outDir}/${name}-legatura-revenita-${w}x${h}.png` });

  const ok = beforeCount === 0 && appeared && cleared;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name} ${w}x${h}  ` +
      `curat-la-start=${beforeCount === 0} banda-apare=${appeared} banda-dispare=${cleared}` +
      (bandText ? `  „${bandText}"` : ""),
  );

  await context.close();
}

await browser.close();
process.exit(failures === 0 ? 0 : 1);
