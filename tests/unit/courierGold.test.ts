import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// §3 al rubricii (`docs/DESIGN-IMERSIV-4-SECTOARE.md`), sectorul CURIER:
// „Accentul auriu rămâne exclusiv pentru bani: câștigul zilei, nimic altceva.
//  Verde doar pentru «online». Roșu doar pentru ceva care îl costă acum."
//
// Regula asta a fost scrisă o dată și încălcată în șase locuri, dintre care cel
// mai mare era chiar butonul „Treci online" — un dreptunghi auriu plin, adică
// obiectul cel mai auriu de pe un ecran unde auriul trebuia să însemne bani.
// Un comentariu n-ar fi prins-o pe a șaptea; testul ăsta o prinde.
//
// Ce verifică: fiecare apariție a lui `gold` pe suprafața de LUCRU a curierului
// (tabloul de bord + ecranul livrării) trebuie să stea pe un rând marcat ca
// fiind despre bani. Nu e analiză de culoare — e o gardă mecanică împotriva
// recidivei, în aceeași familie cu `designTokens.test.ts` de la V4.

const ROOT = join(import.meta.dirname, "../..");

/** Fișierele suprafeței de lucru. `/earnings` și istoricul sunt pagini de bani
 *  cap-coadă, unde auriul e corect prin construcție, deci nu intră aici. */
const WORK_SURFACE = [
  "src/components/courier/CourierCommandBar.tsx",
  "src/components/courier/OnlineToggle.tsx",
  "src/components/courier/OfferCard.tsx",
  "src/components/courier/AvailableOrderRow.tsx",
  "src/components/courier/CourierOfflineSync.tsx",
  "src/components/courier/DeliveryStatusControls.tsx",
  "src/app/(courier)/deliveries/page.tsx",
  "src/app/(courier)/deliveries/[deliveryId]/page.tsx",
];

/** Rânduri care AU voie să fie aurii: sume, câștiguri, încasări, tarife —
 *  plus rama cardului de ofertă, care încadrează un eveniment de bani întreg. */
const ABOUT_MONEY =
  /câștig|castig|c[âa]știgat|MDL|total_mdl|fee_|tip_mdl|net_mdl|încasat|incasat|comision|plata|ring-gold\/40/i;

/** Aurii care nu se pot justifica. Justificarea se caută într-o FEREASTRĂ, nu
 *  pe rândul propriu: în JSX clasa stă aproape întotdeauna pe alt rând decât
 *  valoarea pe care o colorează (`className="… text-gold"` pe un rând,
 *  `{earnedToday}` pe următorul). Verificat pe rândul singur, testul ar fi
 *  raportat ca vinovată exact suma pe care regula o APĂRĂ. */
function unjustifiedGold(file: string): string[] {
  const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
  return lines.filter((line, i) => {
    if (!/\bgold\b|--gold|text-gold|bg-gold|ring-gold/.test(line)) return false;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false; // comentariile explică regula
    const window = lines.slice(Math.max(0, i - 2), i + 4).join("\n");
    return !ABOUT_MONEY.test(window);
  });
}

describe("sectorul curier — auriul înseamnă bani", () => {
  for (const file of WORK_SURFACE) {
    it(`${file}: niciun auriu care nu e o sumă`, () => {
      const offenders = unjustifiedGold(file);
      expect(offenders, `auriu fără bani în ${file}:\n${offenders.join("\n")}`).toEqual([]);
    });
  }

  it("suma câștigată de azi chiar e aurie — regula are și o față pozitivă", () => {
    // Fără aserțiunea asta, testul ar trece perfect pe un sector din care
    // auriul a fost șters cu totul, adică exact opusul a ce cere rubrica.
    const bar = readFileSync(join(ROOT, "src/components/courier/CourierCommandBar.tsx"), "utf8");
    expect(bar).toMatch(/text-gold[^"]*"[^>]*>\s*\{earnedToday\}/);
  });

  it("verdele rămâne al stării online, nu al unei chemări la acțiune", () => {
    const toggle = readFileSync(join(ROOT, "src/components/courier/OnlineToggle.tsx"), "utf8");
    const [onlineBranch, offlineBranch] = toggle.split(/online\s*\n?\s*\?/)[1].split(":");
    expect(onlineBranch).toMatch(/emerald/);
    expect(offlineBranch).not.toMatch(/emerald|gold/);
  });
});

describe("sectorul curier — nimic nou nu strecoară auriu pe lângă gardă", () => {
  it("lista de fișiere acoperă tot ce e sub `components/courier`", () => {
    // Gardă a gărzii: un component nou de curier care folosește `gold` fără să
    // fie trecut în WORK_SURFACE ar scăpa tăcut. Aici cade testul, nu ecranul.
    const dir = join(ROOT, "src/components/courier");
    const untracked = readdirSync(dir)
      .filter((name) => name.endsWith(".tsx") && statSync(join(dir, name)).isFile())
      .map((name) => `src/components/courier/${name}`)
      .filter((path) => !WORK_SURFACE.includes(path))
      .filter((path) => /\bgold\b/.test(readFileSync(join(ROOT, path), "utf8")));

    expect(
      untracked,
      `folosesc auriu dar nu sunt sub gardă — adaugă-le în WORK_SURFACE:\n${untracked.join("\n")}`,
    ).toEqual([]);
  });
});
