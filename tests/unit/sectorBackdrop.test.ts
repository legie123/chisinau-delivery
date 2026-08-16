import { describe, expect, it } from "vitest";
import {
  SECTORS,
  SECTOR_ORDER,
  planBackdrop,
  resolveBackdropMedia,
  resolveMedia,
  type Intensity,
} from "@/components/immersive/sectors";

// Contractul din §2 al rubricii, probat unde poate fi probat: aritmetica
// nivelurilor și lanțul de fallback. Ce arată pe ecran rămâne treaba capturilor
// — un test verde nu e dovadă de UX. Dar dacă cineva schimbă un număr aici
// crezând că mută doar un detaliu, testul spune ce a rupt.

describe("sectors — configurația celor patru", () => {
  it("fiecare sector are poster și gradient, ca lanțul să nu se termine în gol", () => {
    for (const sector of SECTOR_ORDER) {
      const cfg = SECTORS[sector];
      expect(cfg.media.poster, `${sector} fără poster`).toBeTruthy();
      expect(cfg.gradient, `${sector} fără gradient`).toContain("gradient");
    }
  });

  it("orice variantă declarată aduce cu ea propriul poster", () => {
    for (const sector of SECTOR_ORDER) {
      for (const [name, media] of Object.entries(SECTORS[sector].variants ?? {})) {
        expect(media.poster, `${sector}/${name} fără poster`).toBeTruthy();
      }
    }
  });

  it("varianta necunoscută cade pe media sectorului, nu pe nimic", () => {
    // Filtrul poate dispărea din URL, sau poate apărea un tip de locație nou
    // înainte să i se genereze assetul — niciuna nu are voie să lase ecranul gol.
    expect(resolveMedia("concierge", "tip-inexistent")).toEqual(SECTORS.concierge.media);
    expect(resolveMedia("concierge", null)).toEqual(SECTORS.concierge.media);
    expect(resolveMedia("concierge", "spa").video).toBe("/videos/hero-spa.mp4");
  });

  it("hub-ul primește sushi din sectorul client, nu turnatul din pahar", () => {
    expect(resolveMedia("customer", "sushi").video).toBe("/videos/hero-sushi.mp4");
    expect(resolveMedia("customer").video).toBe("/videos/hero-pour.mp4");
  });

  it("sub interfața de lucru a curierului nu se încarcă filmul de pe poartă", () => {
    // Regula 3 a rubricii, aplicată acolo unde doare cel mai tare: `ambient`
    // stă ore în șir sub degetul unui om aflat pe stradă, pe date mobile.
    // `hero-courier.mp4` are 4,15 MB — de trei ori bugetul de 1,5 MB — și era
    // singura media a sectorului, deci montarea lui `ambient` l-ar fi tras
    // tăcut sub bara de comandă, ca să se vadă la 8% opacitate.
    expect(resolveBackdropMedia("courier", "ambient").video).toBeUndefined();
    expect(resolveBackdropMedia("courier", "ambient").poster).toBeTruthy();
    // Poarta curierului (`hero`) rămâne neatinsă — acolo omul chiar se uită.
    expect(resolveBackdropMedia("courier", "hero").video).toBe("/videos/hero-courier.mp4");
  });

  it("un sector fără `ambientMedia` se comportă exact ca înainte", () => {
    for (const sector of SECTOR_ORDER) {
      if (SECTORS[sector].ambientMedia) continue;
      expect(resolveBackdropMedia(sector, "ambient")).toEqual(resolveMedia(sector));
    }
    // și varianta cerută rămâne respectată pe nivelurile care o folosesc
    expect(resolveBackdropMedia("concierge", "hero", "spa")).toEqual(resolveMedia("concierge", "spa"));
  });
});

describe("planBackdrop — cele trei niveluri", () => {
  const motion = { motionOk: true, hasVideo: true };

  it("ambient stă în spate: media aproape stinsă și fără octeți preîncărcați", () => {
    const ambient = planBackdrop("courier", "ambient", motion);
    const hero = planBackdrop("courier", "hero", motion);
    expect(ambient.mediaOpacity).toBeLessThan(hero.mediaOpacity);
    expect(ambient.mediaOpacity).toBeLessThanOrEqual(0.1);
    expect(ambient.preload).toBe("none");
    expect(ambient.fadesOnScroll).toBe(false);
  });

  it("hero se retrage după deschidere — de-aia listele nu mai stau peste film", () => {
    expect(planBackdrop("concierge", "hero", motion).fadesOnScroll).toBe(true);
    expect(planBackdrop("concierge", "ambient", motion).fadesOnScroll).toBe(false);
    expect(planBackdrop("concierge", "focus", motion).fadesOnScroll).toBe(false);
  });

  it("focus e un moment, nu o stare: ține și se stinge singur", () => {
    const focus = planBackdrop("courier", "focus", motion);
    expect(focus.holdMs).toBe(2000);
    expect(focus.drift).toBe(false);
    for (const intensity of ["ambient", "hero"] as Intensity[]) {
      expect(planBackdrop("courier", intensity, motion).holdMs).toBeNull();
    }
  });

  it("fără mișcare permisă: nici video, nici derivă, la orice nivel", () => {
    for (const intensity of ["ambient", "hero", "focus"] as Intensity[]) {
      const plan = planBackdrop("restaurant", intensity, { motionOk: false, hasVideo: true });
      expect(plan.showVideo, intensity).toBe(false);
      expect(plan.drift, intensity).toBe(false);
      expect(plan.driftScale, intensity).toBe(1);
    }
  });

  it("sector fără video generat: planul rămâne valid, doar fără video", () => {
    const plan = planBackdrop("courier", "hero", { motionOk: true, hasVideo: false });
    expect(plan.showVideo).toBe(false);
    expect(plan.veilOpacity).toBeGreaterThan(0);
  });

  it("voalul flăcării e mai gros decât al nopții — dovada e în capturi, nu în gust", () => {
    // Regula 1 a rubricii cere contrast obținut cu un strat. Assetul
    // restaurantului e portocaliu la saturație pe jumătate de cadru; cel al
    // curierului e stradă de noapte. O singură valoare pentru amândouă ar fi
    // ori text pe foc, ori noapte inutil de neagră.
    expect(planBackdrop("restaurant", "hero", motion).veilOpacity).toBeGreaterThan(
      planBackdrop("courier", "hero", motion).veilOpacity,
    );
  });

  it("varianta își duce propria podea de voal, altfel o moștenește", () => {
    // Concierge e întunecat, dar filtrul „Restaurante" împrumută flacăra. Fără
    // override, lumea aia ar rula sub voalul subțire al lounge-ului.
    const lounge = planBackdrop("concierge", "hero", motion);
    const flame = planBackdrop("concierge", "hero", motion, "restaurant");
    const spa = planBackdrop("concierge", "hero", motion, "spa");
    expect(flame.veilOpacity).toBeGreaterThan(lounge.veilOpacity);
    expect(spa.veilOpacity).toBe(lounge.veilOpacity);
  });

  it("fiecare voal stă peste podeaua MĂSURATĂ pe posterul lui", () => {
    // Podelele vin din `node scripts/veil-contrast.mjs` (2026-08-16): opacitatea
    // minimă la care textul de corp (alb 70%) atinge 4.5:1 peste pixelul de
    // percentila 95 din banda de citire a posterului. Nu sunt gusturi — sunt
    // măsurători pe assetul real. Dacă schimbi un poster, RE-RULEAZĂ unealta:
    // testul ăsta e singurul care prinde un asset nou mai luminos decât voalul.
    const PODELE: Array<[string, number, number]> = [
      // [ce măsor, podea măsurată, voalul din config]
      ["courier", 0.5, planBackdrop("courier", "hero", motion).veilOpacity],
      ["restaurant (flacără)", 0.58, planBackdrop("restaurant", "hero", motion).veilOpacity],
      ["concierge (lounge)", 0.11, planBackdrop("concierge", "hero", motion).veilOpacity],
      ["concierge/spa", 0.04, planBackdrop("concierge", "hero", motion, "spa").veilOpacity],
      ["concierge/sushi_bar", 0, planBackdrop("concierge", "hero", motion, "sushi_bar").veilOpacity],
      // lumea „Restaurante" din concierge împrumută flacăra, deci și podeaua ei
      ["concierge/restaurant", 0.58, planBackdrop("concierge", "hero", motion, "restaurant").veilOpacity],
      ["customer (turnat)", 0.53, planBackdrop("customer", "hero", motion).veilOpacity],
      ["customer/sushi (hub)", 0, planBackdrop("customer", "hero", motion, "sushi").veilOpacity],
    ];
    for (const [nume, podea, voal] of PODELE) {
      expect(voal, `${nume}: voal ${voal} sub podeaua măsurată ${podea}`).toBeGreaterThanOrEqual(podea);
    }
  });

  it("voalul stă în interval util pe toate sectoarele", () => {
    // Sub ~0.15 textul alb începe să se piardă; peste ~0.8 mișcarea nu mai
    // citește deloc (lecția plătită în auditul de design: 70% a omorât-o).
    for (const sector of SECTOR_ORDER) {
      const veil = planBackdrop(sector, "hero", motion).veilOpacity;
      expect(veil, sector).toBeGreaterThanOrEqual(0.15);
      expect(veil, sector).toBeLessThanOrEqual(0.8);
    }
  });
});
