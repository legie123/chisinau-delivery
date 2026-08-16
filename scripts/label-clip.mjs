// Este eticheta TĂIATĂ, sau doar pare? — unealtă de probă pentru bucla de design
// (docs/LOOP-NOAPTE.md). Nu e parte din build.
//
// „Text tăiat" se citește greu dintr-o captură când eticheta e mică: `truncate`
// pune trei puncte care arată aproape la fel cu o etichetă întreagă strâmtorată.
// Aici se măsoară în DOM, pe pagina reală, la lățimea reală:
//   - textul RANDAT al elementului (dacă e tăiat cu `text-overflow: ellipsis`,
//     `scrollWidth > clientWidth` pe blocul care taie);
//   - dreptunghiul etichetei față de caseta de conținut a părintelui — o
//     etichetă care începe după marginea dreaptă a părintelui e invizibilă.
//
//   node scripts/label-clip.mjs <cale> <lățime> <rol> <selector-rând> <selector-etichetă>
//
// Ieșire: o linie per potrivire, plus „TĂIAT"/„ÎNTREG" per rând.

import { chromium } from "/Users/user/.npm/_npx/db89d7302a373f10/node_modules/playwright/index.mjs";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3007";
const [, , path, width, role, rowSel, labelSel] = process.argv;

// Intrarea se face prin FORMULARUL real de login, nu prin poarta `/master`:
// pe un server pornit dintr-un worktree, `POST /master/enter/client` întoarce
// 303 dar nu lasă niciun cookie în context (probat de trei ori, rolul `curier`
// trecea în același timp) — deci proba ar fi ieșit „fără potriviri" în loc de
// „întreg". Contul de sămânță e cel din CLAUDE.md. Quirk cunoscut al casei:
// click-ul sintetic pe submit nu declanșează form-ul React — se apasă Enter.
const SEED = {
  client: "client@test.md",
  curier: "curier@test.md",
  restaurant: "partener@test.md",
  platform: "admin@test.md",
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: +width, height: 844 } });
const page = await context.newPage();

if (role) {
  const email = SEED[role];
  if (!email) {
    console.error(`rol necunoscut: ${role} (${Object.keys(SEED).join(", ")})`);
    process.exit(2);
  }
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", "parola123");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(5000);
}
try {
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
} catch {
  await page.waitForTimeout(2500);
}
await page.waitForTimeout(1200);

const rows = await page.$$eval(
  rowSel,
  (nodes, sel) =>
    nodes
      .map((n) => {
        const label = n.querySelector(sel);
        if (!label) return null;
        // Blocul care taie: cel mai apropiat strămoș cu ellipsis activ.
        let clipper = label;
        while (clipper && clipper !== n.parentElement) {
          const cs = getComputedStyle(clipper);
          if (cs.textOverflow === "ellipsis" && cs.overflow !== "visible") break;
          clipper = clipper.parentElement;
        }
        const holder = clipper && clipper !== n.parentElement ? clipper : label.parentElement;
        const hr = holder.getBoundingClientRect();
        const lr = label.getBoundingClientRect();
        return {
          text: label.textContent.trim(),
          holderText: holder.textContent.trim().slice(0, 60),
          scrollWidth: holder.scrollWidth,
          clientWidth: holder.clientWidth,
          overflowPx: Math.max(0, holder.scrollWidth - holder.clientWidth),
          labelRightPx: Math.round(lr.right),
          holderRightPx: Math.round(hr.right),
          labelWidthPx: Math.round(lr.width),
        };
      })
      .filter(Boolean),
  labelSel,
);

if (rows.length === 0) {
  console.error(`fără potriviri pentru ${rowSel} >> ${labelSel} pe ${path} @${width}px`);
  process.exit(2);
}

let clipped = 0;
for (const r of rows) {
  // Tăiat = blocul purtător chiar depășește, SAU eticheta iese din caseta lui.
  const isClipped = r.overflowPx > 0 || r.labelRightPx > r.holderRightPx + 0.5;
  if (isClipped) clipped += 1;
  console.log(
    `${isClipped ? "TĂIAT " : "ÎNTREG"} „${r.text}" · purtător ${r.clientWidth}px, conținut ${r.scrollWidth}px ` +
      `(depășire ${r.overflowPx}px) · eticheta ${r.labelWidthPx}px se termină la ${r.labelRightPx}, ` +
      `purtătorul la ${r.holderRightPx} · „${r.holderText}"`,
  );
}
console.log(`\n${clipped}/${rows.length} tăiate la ${width}px`);

await browser.close();
process.exit(clipped > 0 ? 1 : 0);
