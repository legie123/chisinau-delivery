import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Regula 5 a rubricii (`docs/DESIGN-IMERSIV-4-SECTOARE.md`): „Nicio etichetă care
// minte. Starea afișată = starea reală, întotdeauna."
//
// Un websocket căzut e cel mai tăcut mod de a încălca regula asta: nimic nu se
// strică vizibil, ecranul rămâne exact cum era, iar omul citește o stare veche
// crezând că e de acum. `subscribeTable()` DUCE deja semnalul (`onDegraded` /
// `onHealthy`) — dar consumatorul e liber să nu-l ceară, și trei din opt chiar
// nu-l cereau, fără niciun poll în spate: pagina de catering a clientului,
// pagina livrării curente a curierului și harta de ridicare a partenerului.
//
// Testul ăsta e o gardă mecanică, în aceeași familie cu `courierGold.test.ts`
// (V5) și `designTokens.test.ts` (V4): nu judecă UX, ci verifică două
// proprietăți verificabile pe orice consumator de date vii.
//
//   RECUPERARE — datele redevin adevărate singure (un poll, oricare).
//   ONESTITATE — omul AFLĂ că legătura a căzut, cât timp e căzută.
//
// Recuperarea e obligatorie peste tot. Onestitatea e obligatorie acolo unde
// omul ACȚIONEAZĂ pe baza stării (acceptă o comandă, confirmă o ofertă de
// mii de MDL, pleacă spre un restaurant) — acolo o pagină înghețată nu e doar
// învechită, e o instrucțiune greșită.

const ROOT = join(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");

/** Implementarea însăși — duce semnalul, nu îl consumă. */
const IMPLEMENTATION = "src/lib/realtime/subscribeTable.ts";

/** Consumatori pe a căror stare omul APASĂ ceva. O pagină înghețată aici nu e
 *  o listă veche, e o instrucțiune greșită — deci trebuie să spună că e ruptă. */
const MUST_ANNOUNCE = [
  "src/components/courier/OffersLive.tsx", // oferta expiră în 30s; ratată = penalizare
  "src/components/admin/OrderQueueLive.tsx", // SLA de acceptare 7 min
  "src/components/courier/DeliveryLive.tsx", // reasignare: butoanele pică pe ownership
  "src/components/customer/CateringTracking.tsx", // oferta de catering, medie ~9.000 MDL
  "src/components/admin/RestaurantPickupMap.tsx", // marcatorul curierului pe hartă
];

/** Consumatori cărora li se cere DOAR recuperare, cu motivul scris. Lista e
 *  scurtă și explicită: un consumator nou nu poate ateriza aici din neatenție,
 *  fiindcă garda de mai jos îl cere clasificat. */
const RECOVERY_ONLY: Record<string, string> = {
  "src/hooks/useOrderRealtime.ts":
    "hook fără UI proprie; poll necondiționat la 20s, deci fereastra de minciună e mărginită",
  "src/components/courier/AvailableOrdersLive.tsx":
    "poll necondiționat 30s±10s; lista de comenzi libere e informativă, acțiunea e pe pagina ofertei",
  "src/app/(admin)/platform/OpsLive.tsx":
    "suprafață internă de admin; poll jitterat pe degradare, fără public care să fie indus în eroare",
};

/** Comentariile explică regula — nu o pot îndeplini. Fără pasul ăsta, un
 *  `// TODO: setInterval` ar trece testul, adică exact clasa de comentariu
 *  mincinos interzisă de §5 și plătită deja în V4. */
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
    .join("\n");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Toate fișierele care CONSUMĂ date vii, descoperite din sursă — nu o listă
 *  scrisă de mână care rămâne în urmă la primul component nou. */
function consumers(): string[] {
  return walk(SRC)
    .filter((full) => /\.tsx?$/.test(full))
    .map((full) => relative(ROOT, full))
    .filter((path) => path !== IMPLEMENTATION)
    // Argumentul generic (`subscribeTable<Order>(`) e opțional și e chiar forma
    // majoritară — o primă versiune a detectorului l-a ratat și a „găsit" doar
    // 2 consumatori din 8. Garda gărzii de mai jos a prins-o.
    .filter((path) => /subscribeTable\s*(<[^>]*>)?\s*\(/.test(stripComments(readFileSync(join(ROOT, path), "utf8"))))
    .sort();
}

const SHARED_NOTICE = "src/components/shared/ReconnectNotice.tsx";

const hasRecovery = (src: string) => /startJitteredPoll\s*\(|setInterval\s*\(/.test(src);
/** Semnalul văzut de om: un `role="status"` (citit și de cititorul de ecran)
 *  purtând cuvântul pe care produsul îl folosește deja pentru asta — fie scris
 *  în fișier, fie delegat benzii comune. Delegarea nu e o portiță: banda comună
 *  e verificată separat mai jos, deci cele două căi cer același lucru. */
const hasVisibleSignal = (src: string) =>
  (/role="status"/.test(src) && /Reconectare/i.test(src)) || /<ReconnectNotice[\s/>]/.test(src);
const asksForDegradedSignal = (src: string) => /onDegraded|setDegraded|setConnection/.test(src);

describe("date vii — un canal căzut nu are voie să treacă drept stare curentă", () => {
  for (const file of consumers()) {
    it(`${file}: are cale de recuperare`, () => {
      const src = stripComments(readFileSync(join(ROOT, file), "utf8"));
      expect(
        hasRecovery(src),
        `${file} consumă postgres_changes fără niciun poll în spate: dacă websocket-ul cade, ` +
          `pagina îngheață tăcut pe date vechi și nu revine niciodată singură.`,
      ).toBe(true);
    });
  }

  for (const file of MUST_ANNOUNCE) {
    it(`${file}: spune omului când legătura e căzută`, () => {
      const src = stripComments(readFileSync(join(ROOT, file), "utf8"));
      expect(asksForDegradedSignal(src), `${file} nu cere deloc semnalul de degradare de la subscribeTable`).toBe(true);
      expect(
        hasVisibleSignal(src),
        `${file} primește semnalul dar nu îl arată: omul apasă pe o stare care poate fi veche.`,
      ).toBe(true);
    });
  }
});

describe("banda comună chiar poartă semnalul pe care consumatorii îl deleagă", () => {
  it(`${SHARED_NOTICE}: role=status + cuvântul pe care produsul îl folosește`, () => {
    // Fără aserțiunea asta, `hasVisibleSignal` ar putea fi satisfăcut de un
    // component gol cu numele potrivit — adică exact clasa de „comentariu care
    // minte" plătită în V4, mutată într-un import.
    const src = readFileSync(join(ROOT, SHARED_NOTICE), "utf8");
    expect(src).toMatch(/role="status"/);
    expect(src).toMatch(/Reconectare/);
  });
});

describe("garda gărzii — niciun consumator nou nu scapă neclasificat", () => {
  it("fiecare fișier care cheamă subscribeTable e ori în MUST_ANNOUNCE, ori în RECOVERY_ONLY", () => {
    const unclassified = consumers().filter(
      (file) => !MUST_ANNOUNCE.includes(file) && !(file in RECOVERY_ONLY),
    );
    expect(
      unclassified,
      `consumatori noi de date vii, neclasificați — decide dacă omul acționează pe starea asta ` +
        `(MUST_ANNOUNCE) sau nu (RECOVERY_ONLY, cu motiv scris):\n${unclassified.join("\n")}`,
    ).toEqual([]);
  });

  it("clasificarea acoperă exact consumatorii existenți, fără intrări moarte", () => {
    // Fără aserțiunea asta, un fișier șters ar lăsa în urmă o intrare care face
    // lista să pară mai acoperitoare decât e.
    const found = consumers();
    const stale = [...MUST_ANNOUNCE, ...Object.keys(RECOVERY_ONLY)].filter((file) => !found.includes(file));
    expect(stale, `intrări care nu mai corespund niciunui consumator:\n${stale.join("\n")}`).toEqual([]);
  });
});
