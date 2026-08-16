import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* Garda indicatorului de focus (V10).
 *
 * Regula din `globals.css` a fost scrisă în august 2026 pentru butoane, linkuri
 * și `summary`, cu un comentariu care spunea că „inputurile aveau deja
 * indicator". Nu mai aveau: resetul Tailwind scoate conturul nativ, deci
 * `outline-style` calculat pe caseta de căutare de pe /restaurante era `none`.
 * Măsurat cu `scripts/a11y-audit.mjs` (diferență de pixeli, focus aprins vs
 * stins): 0% pixeli schimbați — un om care ajunge acolo cu Tab nu vede NIMIC.
 * Inelul auriu care se vede în jurul casetei e chenarul ei de repaus, care
 * arată la fel focusat și nefocusat; exact genul de „pare că merge" pe care
 * numai o măsurătoare îl prinde.
 *
 * De ce un test și nu doar reparația: regula e o singură listă de selectori
 * într-un fișier de 400 de linii pe care îl atinge orice val de design. Dacă
 * cineva o rescrie fără `input`, nimic nu cade — nici build, nici tsc, nici o
 * captură — până când un om cu tastatură se pierde pe ecran. Testul citește
 * FIȘIERUL real, nu o copie a lui.
 *
 * Ce NU acoperă, ca să nu pretindă mai mult decât face: că inelul se și VEDE
 * peste fundalul de sub el. Aia se măsoară pe pixeli, cu unealta de mai sus;
 * aici se verifică doar că regula există și acoperă controalele de formular.
 */

const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");

/** CSS-ul fără comentarii — lista de selectori a regulii are un comentariu în
 *  mijlocul ei, iar orice potrivire linie-cu-linie se rupe acolo. (Prima
 *  versiune a gărzii ăsteia s-a rupt exact așa și acuza `button` că lipsește
 *  când `button` era acolo — o gardă care pică din alt motiv decât cel promis
 *  e mai rea decât niciuna, fiindcă valul următor o dezactivează ca fiind
 *  „zgomot".) */
const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Blocul de reguli `:focus-visible` — selectorii lui, fără corp. */
function focusVisibleSelectors(): string[] {
  // `[^{}]*` se întinde înapoi până la acolada precedentă, deci prinde toată
  // lista de selectori indiferent pe câte rânduri e scrisă.
  const block = clean.match(/([^{}]*:focus-visible[^{}]*)\{/);
  if (!block) return [];
  return block[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("indicatorul de focus la tastatură", () => {
  it("acoperă controalele de formular, nu doar butoanele și linkurile", () => {
    const selectors = focusVisibleSelectors();
    // `input` e cel care lipsea și care a produs defectul măsurat în V10.
    for (const tag of ["button", "a", "summary", "input", "select", "textarea"]) {
      expect(
        selectors.some((s) => s === `${tag}:focus-visible`),
        `${tag}:focus-visible lipsește din regula de focus (globals.css) — un om cu tastatură nu vede unde e`,
      ).toBe(true);
    }
  });

  it("desenează un contur vizibil, nu `outline: none`", () => {
    const body = clean.match(/:focus-visible[^{]*\{([^}]*)\}/);
    expect(body).not.toBeNull();
    const decl = body![1];
    expect(decl).toMatch(/outline:\s*2px solid/);
    expect(decl).not.toMatch(/outline:\s*none/);
  });

  it("rămâne pe `:focus-visible`, nu alunecă pe `:focus`", () => {
    // `:focus` simplu ar aprinde inelul și la clic de maus — zgomot vizual pe
    // fiecare apăsare, motivul pentru care regula a fost scrisă așa de la
    // început (audit DesignCode 2026-08-12).
    const plainFocusRing = /(^|\s)(button|a|input):focus\s*[,{]/m.test(clean);
    expect(plainFocusRing).toBe(false);
  });
});
