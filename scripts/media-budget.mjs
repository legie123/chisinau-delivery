// Bugetul de media al imersivului — regula 3 din `docs/DESIGN-IMERSIV-4-SECTOARE.md`:
// „un asset care nu se încarcă în 2 secunde pe 4G nu există" (video sub 1,5 MB,
// poster întotdeauna, `preload="none"` sub fold, zero layout shift la fallback).
//
// De ce o unealtă și nu un `ls -la`: octeții de pe DISC nu sunt octeții de pe
// SÂRMĂ. Un video de 4 MB referit dintr-un sector care nu-l mai folosește costă
// zero; unul de 700 KB tras pe trei suprafețe costă de trei ori. Și mai ales:
// `preload` scris în JSX nu e `preload` din DOM (React nu scrie sigur orice
// atribut), iar CLS-ul nu se poate deduce din cod — se măsoară.
//
//   node scripts/media-budget.mjs <fișier-json> <nume|cale|lățime|înălțime|rol?> ...
//
// Măsoară per suprafață: fiecare resursă din `/videos/`, cu octeții REALI de
// transfer, plus CLS-ul acumulat, plus ce spune DOM-ul despre `preload`/poster.

import { chromium } from "/Users/user/.npm/_npx/db89d7302a373f10/node_modules/playwright/index.mjs";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3007";
const BUDGET_BYTES = 1.5 * 1024 * 1024;
const SETTLE_MS = Number(process.env.MEDIA_SETTLE_MS ?? 7000);

const [, , outFile, ...specs] = process.argv;
if (!outFile || specs.length === 0) {
  console.error("uz: node scripts/media-budget.mjs <out.json> <nume|cale|w|h|rol?> ...");
  process.exit(2);
}

const browser = await chromium.launch();
const results = [];

for (const spec of specs) {
  const [name, path, w, h, role] = spec.split("|");
  // Context nou = cache gol. Măsurăm prima vizită a unui om real, nu a doua.
  const context = await browser.newContext({
    viewport: { width: +w, height: +h },
    deviceScaleFactor: 1,
    // `MEDIA_REDUCED=1` probează regula 3 pe partea ei de liniște: cine cere
    // mai puțină mișcare nu trebuie să plătească octeții filmului.
    ...(process.env.MEDIA_REDUCED ? { reducedMotion: "reduce" } : {}),
  });
  const page = await context.newPage();

  // CLS se colectează din prima, ÎNAINTE de orice navigare: un shift petrecut
  // în timp ce instalăm observatorul e un shift pierdut.
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__shifts = [];
    const describe = (node) => {
      if (!node || node.nodeType !== 1) return "?";
      const el = /** @type {Element} */ (node);
      const cls = (el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}` +
        `["${(el.textContent || "").trim().slice(0, 40)}"]`;
    };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // `hadRecentInput` = omul a apăsat ceva; nu e vina paginii.
          if (entry.hadRecentInput) continue;
          window.__cls += entry.value;
          // Cifra singură spune că doare, nu UNDE. `sources` dă chiar nodurile
          // care s-au mutat — fără ele, „reparăm CLS" înseamnă ghicit.
          if (entry.value > 0.0001) {
            window.__shifts.push({
              value: Number(entry.value.toFixed(4)),
              at: Math.round(entry.startTime),
              sources: (entry.sources || []).slice(0, 3).map((s) => ({
                node: describe(s.node),
                from: `${Math.round(s.previousRect.y)}/${Math.round(s.previousRect.height)}`,
                to: `${Math.round(s.currentRect.y)}/${Math.round(s.currentRect.height)}`,
              })),
            });
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      /* browser fără layout-shift: rămâne 0, raportat ca atare */
    }
    // LCP = momentul în care omul vede lucrul cel mai mare de pe ecran. E
    // metrica pe care un video greu o strică fără să se vadă în `ls -la`:
    // filmul și posterul se bat pe aceeași conexiune, iar posterul e chiar
    // elementul LCP pe paginile de deschidere.
    window.__lcp = 0;
    window.__lcpEl = "";
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__lcp = Math.round(e.startTime);
          window.__lcpEl = e.element ? describe(e.element).slice(0, 60) : e.url?.split("/").pop() || "";
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      /* fără LCP: raportat null, nu inventat */
    }
  });

  // Pe localhost nu există rețea, deci un film de 4 MB și unul de 700 KB sosesc
  // amândouă „instant" și măsurătoarea ar minți exact în favoarea assetului
  // gras. `MEDIA_4G=1` pune profilul „Fast 4G" al Chrome DevTools (4 Mbps jos,
  // 3 sus, 20 ms RTT) — unitatea în care e scrisă regula 3 a rubricii.
  if (process.env.MEDIA_4G) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: (4 * 1000 * 1000) / 8,
      uploadThroughput: (3 * 1000 * 1000) / 8,
      latency: 20,
    });
  }

  // Plasa care a prins o măsurătoare mincinoasă: `.next` e partajat, iar un
  // build pornit de altcineva schimbă hash-urile chunk-urilor SUB serverul care
  // rulează deja. Pagina cere atunci un `.css` care nu mai există, se randează
  // aproape nestilată — și tot ce măsori după (CLS, poziții, contrast) descrie
  // o pagină care nu există. Un 404 pe CSS/JS invalidează rularea, nu o
  // colorează: mai bine zero cifre decât cifre false.
  const broken = [];
  page.on("response", (res) => {
    const t = res.request().resourceType();
    if ((t === "stylesheet" || t === "script") && res.status() >= 400) {
      broken.push(`${res.status()} ${res.url().split("/").pop()}`);
    }
  });

  if (role) {
    await page.goto(`${BASE}/master`, { waitUntil: "domcontentloaded" });
    await context.request.post(`${BASE}/master/enter/${role}`);
  }

  try {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch {
    /* pagina lentă se măsoară oricum după așteptarea de mai jos */
  }
  // Video-ul curge în fundal după `domcontentloaded`; îl lăsăm să se așeze.
  await page.waitForTimeout(SETTLE_MS);

  const data = await page.evaluate(() => {
    const media = performance
      .getEntriesByType("resource")
      .filter((r) => r.name.includes("/videos/"))
      .map((r) => ({
        file: r.name.split("/").pop(),
        transfer: r.transferSize,
        encoded: r.encodedBodySize,
        ms: Math.round(r.duration),
      }));
    const videos = [...document.querySelectorAll("video")].map((v) => ({
      preload: v.preload,
      src: (v.currentSrc || v.src).split("/").pop(),
      poster: (v.poster || "").split("/").pop(),
      readyState: v.readyState,
    }));
    const posters = [...document.querySelectorAll('img[src*="/videos/"]')].map((i) => ({
      src: i.src.split("/").pop(),
      complete: i.complete,
      natural: i.naturalWidth,
    }));
    return {
      media,
      videos,
      posters,
      cls: window.__cls ?? null,
      shifts: window.__shifts ?? [],
      lcp: window.__lcp ?? null,
      lcpEl: window.__lcpEl ?? "",
    };
  });

  const bytes = data.media.reduce((s, m) => s + (m.transfer || 0), 0);
  results.push({ name, path, viewport: `${w}x${h}`, bytes, broken, ...data });

  if (broken.length) {
    console.error(
      `\n✗ ${name} ${w}px: pagina a cerut resurse care nu există (${broken.join(", ")}).` +
        `\n  Serverul rulează pe alt build decât cel de pe disc — repornește-l și reia.` +
        `\n  Măsurătoarea se oprește: o cifră dintr-o pagină nestilată e mai rea decât nicio cifră.`,
    );
    await browser.close();
    process.exit(3);
  }

  const over = data.media.filter((m) => m.encoded > BUDGET_BYTES);
  console.log(
    `${name.padEnd(22)} ${String(w).padStart(4)}px  media ${(bytes / 1024).toFixed(0).padStart(5)} KB` +
      `  LCP ${String(data.lcp ?? "n/a").padStart(4)}ms` +
      `  CLS ${data.cls === null ? "n/a" : data.cls.toFixed(4)}` +
      `  video[${data.videos.map((v) => `${v.src}:${v.preload}`).join(",") || "—"}]` +
      (over.length ? `  ⚠ PESTE BUGET: ${over.map((o) => o.file).join(",")}` : ""),
  );
}

await browser.close();

const { writeFileSync } = await import("node:fs");
writeFileSync(outFile, JSON.stringify(results, null, 2));

const worstCls = Math.max(...results.map((r) => r.cls ?? 0));
const heaviest = Math.max(...results.map((r) => r.bytes));
console.log(
  `\ntotal suprafețe ${results.length} · cea mai grea ${(heaviest / 1024).toFixed(0)} KB` +
    ` · CLS maxim ${worstCls.toFixed(4)} · scris în ${outFile}`,
);
