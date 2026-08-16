// Rigla pentru ecranul de telefon: ce iese din fereastră și ce stă peste ce.
// Unealtă de probă (nu intră în build), scrisă fiindcă „se înghesuie" nu e o
// măsurătoare — un buton împins la 502px într-o fereastră de 390px nu e
// densitate, e o acțiune la care nu ajungi fără să tragi pagina lateral.
//
//   node scripts/overflow-audit.mjs <cale> <lățime> <înălțime> [rol]
//
// Raportează trei lucruri, toate din geometria reală a paginii randate:
//   1. lățimea documentului vs lățimea ferestrei (derapaj orizontal)
//   2. fiecare element interactiv care depășește marginea din dreapta
//   3. fiecare element `fixed` care acoperă conținut (suprafața suprapunerii)

import { chromium } from "/Users/user/.npm/_npx/db89d7302a373f10/node_modules/playwright/index.mjs";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3007";
const [, , path, w, h, role] = process.argv;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: +w, height: +h } });
const page = await context.newPage();

// Răbdare mare deliberat: serverul de dezvoltare e împărțit cu ceilalți
// muncitori ai buclei (măsurat: load 28, un răspuns în 28 s). O expirare de
// 30 s ar raporta „pagina nu se încarcă" despre o pagină care se încarcă —
// adică unealta ar minți despre produs, ca cele reparate în V10.
const PATIENCE = 180000;
if (role) {
  await page.goto(`${BASE}/master`, { waitUntil: "domcontentloaded", timeout: PATIENCE });
  await context.request.post(`${BASE}/master/enter/${role}`, { timeout: PATIENCE });
}
try {
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: PATIENCE });
} catch {
  await page.waitForTimeout(2500);
}
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const label = (el) =>
    (el.getAttribute("aria-label") || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 46) || `<${el.tagName.toLowerCase()}>`;

  // Indicatorul de dezvoltare Next.js nu e produs — se exclude explicit, ca să
  // nu semneze nimeni o cifră despre un element care nu se livrează.
  const isDevPortal = (el) => !!el.closest("nextjs-portal");

  const interactive = [...document.querySelectorAll("button, a, input, select, [role='button']")].filter(
    (el) => !isDevPortal(el) && el.getBoundingClientRect().width > 0,
  );

  // Un element care iese din fereastră nu e automat inaccesibil: dacă are un
  // strămoș care se derulează pe orizontală (bara de navigare a partenerului e
  // `overflow-x-auto` deliberat), omul ajunge la el trăgând bara. Distincția
  // asta trebuie făcută de unealtă, nu de cititorul raportului — altfel
  // raportează patru „defecte" care nu sunt, și nimeni nu mai crede al
  // cincilea, care e.
  const scrollableAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === "auto" || ox === "scroll") && p.scrollWidth > p.clientWidth + 1) return p;
    }
    return null;
  };

  const overflowing = interactive
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.right > vw + 0.5)
    .map(({ el, r }) => {
      const scroller = scrollableAncestor(el);
      return {
        label: label(el),
        right: Math.round(r.right * 10) / 10,
        cutPx: Math.round((r.right - vw) * 10) / 10,
        // `true` = accesibil prin derulare (nu e defect); `false` = împins în
        // afara paginii, deci de neatins fără să tragi tot documentul lateral.
        reachableByScroll: !!scroller,
      };
    });

  // Elemente ancorate în fereastră: cât conținut acoperă în acest cadru.
  const fixed = [...document.querySelectorAll("body *")].filter(
    (el) => !isDevPortal(el) && getComputedStyle(el).position === "fixed" && el.getBoundingClientRect().width > 0,
  );
  const covered = [];
  for (const f of fixed) {
    const fr = f.getBoundingClientRect();
    if (fr.width === 0 || fr.height === 0) continue;
    for (const el of document.querySelectorAll("main *")) {
      if (isDevPortal(el) || f.contains(el) || el.contains(f)) continue;
      if (!el.textContent?.trim() && el.tagName !== "BUTTON") continue;
      if (el.children.length > 0) continue; // doar frunze, altfel se numără de N ori
      const r = el.getBoundingClientRect();
      const ox = Math.min(fr.right, r.right) - Math.max(fr.left, r.left);
      const oy = Math.min(fr.bottom, r.bottom) - Math.max(fr.top, r.top);
      if (ox > 1 && oy > 1) {
        covered.push({
          by: label(f),
          what: label(el),
          overlap: `${Math.round(ox)}x${Math.round(oy)}px`,
          interactive: !!el.closest("button, a, input, [role='button']"),
        });
      }
    }
  }

  // Cine anume lățește documentul. Elementele interactive de mai sus sunt cele
  // care dor, dar derapajul îl poate produce orice text — iar fără numele lui
  // reparația e ghicit, nu măsurat.
  const widest = [...document.querySelectorAll("body *")]
    .filter((el) => !isDevPortal(el))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.right > vw + 0.5 && r.width > 0)
    .sort((a, b) => b.r.right - a.r.right)
    .slice(0, 6)
    .map(({ el, r }) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.className?.toString?.() ?? "").slice(0, 60),
      label: label(el),
      right: Math.round(r.right * 10) / 10,
      inScroller: !!scrollableAncestor(el),
    }));

  return {
    viewportWidth: vw,
    documentWidth: document.documentElement.scrollWidth,
    horizontalScroll: document.documentElement.scrollWidth - vw,
    overflowing,
    widest,
    covered,
  };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
