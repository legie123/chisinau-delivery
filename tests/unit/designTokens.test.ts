import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* Garda stratului de tokeni (V4).
 *
 * `globals.css` declară acum paleta și scara tipografică o singură dată, iar
 * `premium.css` doar le referă. Sursa de adevăr rămâne `docs/design/dragons-dna.json`.
 * Fără gardă, cele două se despart tăcut: cineva schimbă un hex în CSS, ADN-ul
 * rămâne vechi, și fișierul pe care „orice builder de UI îl citește înainte să
 * scrie stiluri" (regula din docs/design/README.md) începe să mintă.
 *
 * Testul citește fișierele reale — nu o copie a valorilor — ca să nu poată trece
 * verde dacă doar el e actualizat.
 */

const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");
const dna = JSON.parse(
  readFileSync(resolve(__dirname, "../../docs/design/dragons-dna.json"), "utf8"),
);

/** Ia valoarea unei variabile CSS din blocul `:root`/`@theme` al fișierului. */
function cssVar(name: string): string | undefined {
  const m = css.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "m"));
  return m?.[1].trim();
}

describe("tokenii de paletă urmăresc ADN-ul", () => {
  // Rampa de aur periat și cea de ametist sunt scrise în ADN ca listă de patru
  // trepte în `meta.source_references`; valorile canonice per rol stau în
  // `design_system.color`. Verificăm rolurile numite, nu toată rampa, fiindcă
  // doar ele au un nume în ADN.
  const cases: Array<[string, string]> = [
    ["navy-0", dna.design_system.color.surface.background],
    ["navy-3", dna.design_system.color.surface.elevated],
    ["gold-1", dna.design_system.color.secondary.hex],
    ["amethyst-2", dna.design_system.color.accent.hex],
    ["success", dna.design_system.color.semantic.success],
    ["warning", dna.design_system.color.semantic.warning],
    ["error", dna.design_system.color.semantic.error],
    ["info", dna.design_system.color.semantic.info],
  ];

  it.each(cases)("--%s = %s", (name, expected) => {
    expect(cssVar(name)).toBe(expected);
  });

  it("substratul navy respectă scara de neutre din ADN", () => {
    // ADN: neutral.scale merge de la cel mai adânc la cel ridicat.
    const scale: string[] = dna.design_system.color.neutral.scale;
    expect(scale).toContain(cssVar("navy-0"));
    expect(scale).toContain(cssVar("navy-1"));
    expect(scale).toContain(cssVar("navy-2"));
    expect(scale).toContain(cssVar("navy-3"));
  });

  it("roșul de pericol și primarul sunt aceeași decizie, nu două culori", () => {
    // ADN: roșul mărcii e rezervat strict pericolului. Dacă cineva le desparte,
    // apar două roșuri care arată la fel dar se schimbă separat.
    expect(cssVar("error")).toBe(cssVar("primary"));
  });
});

describe("scara tipografică urmărește ADN-ul", () => {
  // Numele din CSS nu sunt identice cu cheile din ADN (Tailwind cere `text-h1`,
  // ADN-ul scrie `heading_1`) — harta e explicită ca să nu se ghicească.
  const steps: Array<[string, string]> = [
    ["display", "display"],
    ["h1", "heading_1"],
    ["h2", "heading_2"],
    ["h3", "heading_3"],
    ["body", "body"],
    ["body-sm", "body_small"],
    ["caption", "caption"],
    ["overline", "overline"],
  ];

  it.each(steps)("treapta --text-%s se potrivește cu %s din ADN", (cssName, dnaKey) => {
    const step = dna.design_system.typography.type_scale[dnaKey];
    expect(cssVar(`text-${cssName}`)).toBe(step.size);
    expect(cssVar(`text-${cssName}--line-height`)).toBe(step.line_height);
    expect(cssVar(`text-${cssName}--letter-spacing`)).toBe(step.tracking);
    expect(cssVar(`text-${cssName}--font-weight`)).toBe(step.weight);
  });

  it("acoperă toate cele opt trepte din ADN, nu doar cele folosite azi", () => {
    expect(Object.keys(dna.design_system.typography.type_scale).sort()).toEqual(
      steps.map(([, k]) => k).sort(),
    );
  });
});

describe("premium.css nu mai redeclară paleta", () => {
  const premium = readFileSync(
    resolve(__dirname, "../../src/app/(admin)/restaurant/premium.css"),
    "utf8",
  );

  it("variabilele --pg-* de culoare referă definiția unică, nu hexuri proprii", () => {
    // Blocul :root al lui premium.css e locul unde erau redeclarate aceleași
    // patru navy-uri și opt metale. Utilitarele `.pg-*` de mai jos pot conține
    // hexuri (umbre, rgba) — garda se aplică doar declarațiilor de token.
    const root = premium.slice(premium.indexOf(":root"), premium.indexOf("}", premium.indexOf(":root")));
    const hardcoded = [...root.matchAll(/--pg-(?:navy|gold|amethyst)-\d:\s*(#[0-9a-fA-F]{6})/g)];
    expect(hardcoded.map((m) => m[0])).toEqual([]);
  });
});
