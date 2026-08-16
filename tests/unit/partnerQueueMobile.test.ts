import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* Garda ecranului de telefon al partenerului (R3).
 *
 * Măsurat cu `scripts/overflow-audit.mjs` pe `/restaurant/orders` la 390×844,
 * cu două comenzi reale în coadă: documentul avea **502 px într-o fereastră de
 * 390** — 112 px de derapaj lateral — iar cele două butoane principale ale
 * partenerului ieșeau din ecran: „Acceptă" tăiat cu 18,6 px, „Refuză" cu
 * 111,9 px, adică ÎN ÎNTREGIME în afara ferestrei. Pe suprafața despre care §4
 * al rubricii spune „20 de secunde de atenție", omul de la tejghea trebuia să
 * tragă pagina lateral ca să poată refuza o comandă.
 *
 * Cauza nu era lățimea butoanelor, ci două implicite de flexbox care se
 * adună: un element de flex are `min-width: auto`, deci coloana de text NU
 * poate coborî sub lățimea ei minimă de conținut (rândul cu câmpul de timp de
 * pregătire: etichetă + input de 64 px + buton), iar blocul de acțiuni era
 * `shrink-0`. Nimeni nu cedează ⇒ rândul crește peste fereastră. Reparat cu
 * `min-w-0` pe coloana de text (are voie să se strângă) plus dreptul rândului
 * de a se rupe, ca butoanele să coboare pe propriul rând la telefon.
 *
 * De ce un test și nu doar reparația: derapajul nu pică nici build, nici tsc,
 * nici lint — se vede numai într-o captură pe care cineva trebuie s-o
 * deschidă, iar `flex-wrap`/`min-w-0` sunt exact genul de clase pe care un val
 * de design viitor le șterge fiindcă „nu par să facă nimic". Testul citește
 * FIȘIERELE reale.
 *
 * Ce NU acoperă, ca să nu pretindă mai mult decât face: că rezultatul chiar
 * încape în 390 px. Aia se măsoară pe pagina randată, cu unealta de mai sus
 * (documentWidth === viewportWidth, zero elemente interactive tăiate) — testul
 * ăsta verifică doar că mecanismul care o face posibilă e încă în cod.
 */

/* Sursa FĂRĂ comentarii. Capcană plătită de două ori până acum în repo-ul ăsta
 * (`focusVisible.test.ts` o scrie pentru CSS, V10 a rescris o gardă care pica
 * pe `button` din cauza unui comentariu): garda de mai jos descrie în cuvinte
 * exact clasele pe care le interzice, deci propriul ei comentariu explicativ o
 * face să pice. O gardă care pică din alt motiv decât cel promis e mai rea
 * decât niciuna. */
const stripComments = (src: string) =>
  src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "") // {/* comentariu JSX */}
    .replace(/\/\*[\s\S]*?\*\//g, "") // /* bloc */
    .replace(/^[ \t]*\/\/.*$/gm, ""); // // linie

const read = (p: string) => stripComments(readFileSync(resolve(__dirname, "../../", p), "utf8"));

const row = read("src/components/admin/OrderQueueRow.tsx");
const live = read("src/components/admin/OrderQueueLive.tsx");
const page = read("src/app/(admin)/restaurant/orders/page.tsx");

/** Blocul JSX al rândului de antet (emoji + text + butoane) din OrderQueueRow. */
function headerRow(): string {
  const start = row.indexOf('<div className="flex w-full');
  expect(start, "rândul de antet al comenzii nu mai există în forma așteptată").toBeGreaterThan(-1);
  // Până la lista de produse — tot ce ne interesează stă înainte de ea.
  const end = row.indexOf("{items.length > 0", start);
  return row.slice(start, end > start ? end : start + 3000);
}

describe("coada partenerului la 390 px", () => {
  it("rândul de comandă are voie să se rupă, deci butoanele nu pot fi împinse afară", () => {
    const header = headerRow();
    expect(header, "rândul de antet trebuie să se poată rupe pe telefon").toMatch(/flex-wrap/);
  });

  it("coloana de text se poate strânge (min-w-0), altfel ea împinge butoanele", () => {
    const header = headerRow();
    // Ambele niveluri: containerul emoji+text ȘI coloana de text din el.
    // Fără cel din interior, `min-width:auto` reapare un nivel mai jos.
    const occurrences = header.match(/min-w-0/g) ?? [];
    expect(occurrences.length, "min-w-0 lipsește pe un nivel al coloanei de text").toBeGreaterThanOrEqual(2);
  });

  it("blocul de acțiuni ocupă propriul rând pe telefon și revine lângă text de la sm", () => {
    const header = headerRow();
    // Blocul de acțiuni e al DOILEA `w-full` din rând (primul e rândul însuși).
    // Se caută clasele pe același element, nu lipite una de alta — ordinea
    // claselor Tailwind nu e un contract.
    const actionBlock = header.match(/<div className="flex w-full[^"]*sm:w-auto"/);
    expect(actionBlock, "blocul de butoane trebuie w-full pe telefon și w-auto de la sm").not.toBeNull();
  });

  /* Banda de reconectare: `fixed` peste o pagină care se derulează acoperă
   * ORICE nimerește dedesubt. Măsurat înainte: 195×12 px peste titlul
   * „Ultimele 30 de zile", iar cu coada goală peste butonul „Activează
   * notificările" — adică peste o acțiune. Plasarea `flow` din
   * `ReconnectNotice` (câștigată pe ecranul curierului în V5) stă în flux,
   * deci își rezervă singură spațiul și nu poate acoperi nimic la nicio
   * lățime. */
  it("banda de reconectare a partenerului nu mai plutește peste conținut", () => {
    expect(live, "banda nu mai are voie să fie `fixed`").not.toMatch(/fixed bottom-/);
    expect(live, "trebuie să folosească banda comună, în flux").toMatch(/ReconnectNotice/);
  });

  /* Aceeași familie cu cele trei minciuni reparate în V11: un punct care
   * pulsează promite „acum". `get_prep_estimates` întoarce o medie pe 28 de
   * zile — o măsurătoare, nu un semnal viu. */
  it("media pe 28 de zile nu mai poartă punctul care pulsează", () => {
    const pill = page.slice(page.indexOf("prepEstimate &&"), page.indexOf("orderList.length === 0"));
    expect(pill, "pastila de timp de pregătire nu mai are voie să folosească pg-live-dot").not.toMatch(/pg-live-dot/);
  });
});
