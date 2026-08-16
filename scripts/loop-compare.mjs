// Compară candidații de fundal pentru un sector — cadru cu cadru, nu din ochi.
// Unealtă de probă pentru rubrica vizuală (docs/DESIGN-IMERSIV-4-SECTOARE.md §5:
// „se compară cadru cu cadru și câștigătorul rămâne, chiar dacă e cel vechi";
// §8: „dacă noul asset nu bate vizibil vechiul, rămâne vechiul și se scrie de ce").
//
//   node scripts/loop-compare.mjs a.mp4 b.mp4 [...]
//
// De ce nu ajunge `veil-contrast.mjs`: acela măsoară POSTERUL, adică UN cadru.
// Un fundal are 120-216. Voalul calibrat pe posterul întunecat cade exact în
// secunda în care se aprinde lampa — și atunci textul de deasupra pierde
// contrastul pe care tabelul îl declara câștigat. Aici percentila 95 se ia pe
// cadrul CEL MAI LUMINOS din tot loop-ul, deci podeaua nu mai depinde de norocul
// alegerii posterului.
//
// Patru axe, toate din rubrică, toate numere:
//   greutate  — regula 3: sub 1,5 MB per sector, altfel „assetul nu există"
//   cusătură  — §5 cere `seamless loop`: cât de tare sare ultimul cadru în primul
//   derivă    — regula 4: mișcare lentă cu motiv; un fundal care se agită fură atenția
//   podea     — regula 1: voalul necesar ca textul de corp să treacă de 4.5:1
//
// Zero dependențe: ffmpeg scoate cadre rgb24 brute pe stdout, node le citește ca
// octeți. Nicio bibliotecă de imagini, nimic de instalat.

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

const W = 160; // lățimea de analiză; detaliul fin nu contează pentru luminanță
const BUDGET_MB = 1.5; // regula 3
const VEIL = [10, 10, 20]; // #0a0a14 — substratul navy al aplicației

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("folosire: node scripts/loop-compare.mjs a.mp4 b.mp4 ...");
  process.exit(1);
}

const lin = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const lumOf = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = (bg, alpha) => bg.map((c, i) => alpha * VEIL[i] + (1 - alpha) * c);
const white70 = (bg) => bg.map((c) => 0.7 * 255 + 0.3 * c);
const ratio = (fg, bg) => {
  const [a, b] = [lumOf(fg) + 0.05, lumOf(bg) + 0.05].sort((x, y) => y - x);
  return a / b;
};

/** Voalul minim la care textul de corp (alb 70%) trece de 4.5:1 peste `px`. */
function veilNeeded(px) {
  for (let a = 0; a <= 100; a++) {
    const bg = over(px, a / 100);
    if (ratio(white70(bg), bg) >= 4.5) return a / 100;
  }
  return null;
}

function probe(file) {
  // Cu chei, nu pe poziție: ffprobe scoate câmpurile în ordinea din structura
  // fluxului, nu în ordinea cerută — citite pe index, durata ieșea „216 s".
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries",
     "stream=width,height,duration,avg_frame_rate", "-of", "default=nw=1", file],
    { encoding: "utf8" },
  );
  const get = (key) => out.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? "";
  const [num, den] = get("avg_frame_rate").split("/");
  return {
    width: +get("width"),
    height: +get("height"),
    duration: +get("duration"),
    fps: den ? +num / +den : +num,
  };
}

/** Toate cadrele, la lățime mică, ca triplete rgb — direct din stdout-ul ffmpeg. */
function frames(file, height) {
  const h = Math.max(2, Math.round(height / 2) * 2);
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-vf", `scale=${W}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", maxBuffer: 1 << 30 },
  );
  const per = W * h * 3;
  const out = [];
  for (let f = 0; f + per <= buf.length; f += per) out.push(buf.subarray(f, f + per));
  return { list: out, w: W, h };
}

const rows = [];
for (const file of files) {
  const meta = probe(file);
  const { list, w, h } = frames(file, Math.round((meta.height / meta.width) * W));
  const bytes = statSync(file).size;

  // Banda de citire: 25%-75% pe verticală, ca în `veil-contrast.mjs` — acolo stă
  // textul de hero. Se măsoară pe FIECARE cadru, iar podeaua o dă cel mai aprins.
  const top = Math.round(h * 0.25);
  const bottom = Math.round(h * 0.75);
  let worst = { p95: [0, 0, 0], lum: -1, frame: -1 };
  const curve = [];
  list.forEach((buf, idx) => {
    const px = [];
    for (let y = top; y < bottom; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        px.push([buf[i], buf[i + 1], buf[i + 2]]);
      }
    }
    const lums = px.map(lumOf).sort((a, b) => a - b);
    const target = lums[Math.floor(lums.length * 0.95)];
    let best = px[0];
    let bestDiff = Infinity;
    for (const p of px) {
      const d = Math.abs(lumOf(p) - target);
      if (d < bestDiff) { bestDiff = d; best = p; }
    }
    curve.push(target);
    if (target > worst.lum) worst = { p95: best, lum: target, frame: idx };
  });

  // Plasa de siguranță a măsurătorii: „cel mai luminos cadru" e o afirmație care
  // decide un voal, deci se arată curba, nu doar vârful. TRACE=1 o tipărește.
  if (process.env.TRACE) {
    const at = (frac) => curve[Math.min(curve.length - 1, Math.round(frac * (curve.length - 1)))];
    console.log(
      `${file.split("/").pop()} · luminanță p95 pe cadre: ` +
        [0, 0.25, 0.5, 0.75, 1].map((f) => `${Math.round(f * 100)}%=${at(f).toFixed(3)}`).join("  ") +
        `  · vârf ${worst.lum.toFixed(3)} @${worst.frame}`,
    );
  }

  // Cusătura loop-ului: ultimul cadru vs primul, pe scara 0-100 a canalului.
  const diff = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return (sum / a.length / 255) * 100;
  };
  const seam = diff(list[list.length - 1], list[0]);

  // Deriva: cât se schimbă cadrul mediu față de vecinul lui. Mult = agitație.
  let drift = 0;
  for (let i = 1; i < list.length; i++) drift += diff(list[i], list[i - 1]);
  drift /= list.length - 1;

  const floor = veilNeeded(worst.p95);
  rows.push({
    fișier: file.split("/").pop(),
    MB: (bytes / 1e6).toFixed(2),
    "buget §3": bytes / 1e6 <= BUDGET_MB ? "da" : `NU (×${(bytes / 1e6 / BUDGET_MB).toFixed(1)})`,
    dim: `${meta.width}×${meta.height}`,
    s: meta.duration.toFixed(1),
    cadre: `${list.length} @${Math.round(meta.fps)}`,
    cusătură: seam.toFixed(2),
    derivă: drift.toFixed(2),
    "cadru aprins": worst.frame,
    "podea voal": floor === null ? "imposibil" : floor.toFixed(2),
    "la 0.40": ratio(white70(over(worst.p95, 0.4)), over(worst.p95, 0.4)).toFixed(2),
  });
}

console.table(rows);
console.log(
  "\ncusătură = |ultimul cadru − primul|, 0-100 (mai mic = loop mai curat)" +
  "\nderivă   = |cadru − cadrul dinainte|, medie (mai mic = mișcare mai lentă)" +
  "\npodea    = voalul minim la care albul/70 trece de 4.5:1 pe CEL MAI LUMINOS cadru" +
  "\nla 0.40  = contrastul real al textului de corp cu voalul de azi al concierge-ului",
);
