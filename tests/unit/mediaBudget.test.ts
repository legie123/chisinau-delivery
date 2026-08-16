import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTORS, SECTOR_ORDER, type SectorMedia } from "@/components/immersive/sectors";

// Regula 3 din `docs/DESIGN-IMERSIV-4-SECTOARE.md`, ca gardă și nu ca intenție:
// „un asset care nu se încarcă în 2 secunde pe 4G nu există" — video sub 1,5 MB,
// poster întotdeauna, zero salt de layout.
//
// De ce testul ăsta există: valul V9 a găsit pe disc patru filme peste buget
// (`hero-courier` 4,15 MB, `hero-flame` 2,78, `hero-lounge` 2,60, iar
// `hero-sushi` la 1,43 nici nu apucase să se descarce în 12 secunde de 4G).
// Niciunul nu încălca vreo linie de cod — încălcau o propoziție dintr-un
// document. O propoziție nu oprește pe nimeni; o cifră care pică build-ul, da.

const PUBLIC = join(import.meta.dirname, "../../public");
const BUGET_VIDEO_KB = 1536; // 1,5 MB, regula 3
const kb = (p: string) => statSync(join(PUBLIC, p)).size / 1024;

/** Toate assetele declarate de contract, cu locul lor spus pe nume — ca un
 *  eșec să arate CARE lume din CARE sector a depășit, nu doar că „ceva" a. */
function allDeclaredMedia(): Array<{ where: string; media: SectorMedia }> {
  const out: Array<{ where: string; media: SectorMedia }> = [];
  for (const sector of SECTOR_ORDER) {
    const cfg = SECTORS[sector];
    out.push({ where: `${sector}.media`, media: cfg.media });
    if (cfg.ambientMedia) out.push({ where: `${sector}.ambientMedia`, media: cfg.ambientMedia });
    for (const [name, media] of Object.entries(cfg.variants ?? {})) {
      out.push({ where: `${sector}.${name}`, media });
    }
  }
  // varianta lată e tot un asset care pleacă pe sârmă
  for (const entry of [...out]) {
    if (entry.media.wide) {
      out.push({ where: `${entry.where}.wide`, media: entry.media.wide as SectorMedia });
    }
  }
  return out;
}

describe("bugetul de media al imersivului (regula 3)", () => {
  it("niciun video declarat nu trece de 1,5 MB", () => {
    const peste: string[] = [];
    for (const { where, media } of allDeclaredMedia()) {
      if (!media.video) continue;
      const size = kb(media.video);
      if (size > BUGET_VIDEO_KB) peste.push(`${where} → ${media.video} = ${Math.round(size)} KB`);
    }
    expect(peste, `peste bugetul de ${BUGET_VIDEO_KB} KB:\n${peste.join("\n")}`).toEqual([]);
  });

  it("fiecare asset declarat există pe disc, cu posterul lui", () => {
    // Posterul e al doilea nivel al lanțului de fallback: fără el, un video
    // care nu pornește lasă gradientul singur, iar deschiderea de ecran devine
    // o suprafață goală. Tipul obligă la un `poster`; testul obligă la un
    // FIȘIER (o cale scrisă greșit trece de TypeScript și cade abia în browser).
    for (const { where, media } of allDeclaredMedia()) {
      expect(() => kb(media.poster), `${where}: poster lipsă ${media.poster}`).not.toThrow();
      if (media.video) {
        expect(() => kb(media.video!), `${where}: video lipsă ${media.video}`).not.toThrow();
      }
    }
  });

  it("suma de pe cea mai grea deschidere rămâne sub o secundă de 4G", () => {
    // 4 Mbps (profilul „Fast 4G" din Chrome DevTools, cel folosit de
    // `scripts/media-budget.mjs`) = 500 KB/s. Deschiderea unui ecran trage
    // poster + video, deci ele se adună; ținta e ca perechea să încapă în
    // bugetul unui singur video, nu ca fiecare să încapă separat.
    for (const { where, media } of allDeclaredMedia()) {
      if (!media.video) continue;
      const total = kb(media.poster) + kb(media.video);
      expect(total, `${where} = ${Math.round(total)} KB`).toBeLessThan(BUGET_VIDEO_KB);
    }
  });
});

describe("podeaua de layout a suprafeței de client (CLS)", () => {
  it("zona de conținut rezervă o fereastră, ca subsolul să nu sară", () => {
    // Măsurat, nu presupus: fără podea, subsolul se picta la y=373 din 844 și
    // era împins la y=4000+ când sosea conținutul streamuit — CLS 0,558, adică
    // de peste două ori pragul „slab" al Google (0,25). Vezi comentariul din
    // layout și cifrele din jurnalul V9.
    const layout = readFileSync(
      join(import.meta.dirname, "../../src/app/(customer)/layout.tsx"),
      "utf8",
    );
    const wrapper = layout.match(/<div className="([^"]*max-w-5xl[^"]*)">\{children\}<\/div>/);
    expect(wrapper, "învelișul de conținut al layoutului de client nu mai e recognoscibil").toBeTruthy();
    expect(
      /min-h-(svh|dvh|screen|\[100svh\])/.test(wrapper![1]),
      `fără podea de fereastră pe zona de conținut: "${wrapper![1]}"`,
    ).toBe(true);
  });
});
