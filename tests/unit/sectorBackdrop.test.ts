import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SECTORS,
  SECTOR_ORDER,
  planBackdrop,
  resolveBackdropMedia,
  resolveMedia,
  type Intensity,
  type Sector,
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
    // Aserțiunea de dinainte pironea lumea „spa" pe `hero-spa.mp4`. A devenit
    // legitim învechită în V6: măsurat cadru cu cadru, filmul acela cădea la
    // 3.25:1 în ultima secundă și a fost înlocuit. Ce conta de fapt e că o lume
    // DECLARATĂ își primește propriul asset, nu că e un fișier anume — pironit
    // pe fișier, testul ar cere o rescriere la fiecare asset nou.
    expect(resolveMedia("concierge", "business_lounge")).toEqual(
      SECTORS.concierge.variants?.business_lounge,
    );
    expect(resolveMedia("concierge", "business_lounge").video).not.toBe(
      SECTORS.concierge.media.video,
    );
  });

  it("hub-ul primește sushi din sectorul client, nu turnatul din pahar", () => {
    expect(resolveMedia("customer", "sushi").video).toBe("/videos/hero-sushi.mp4");
    expect(resolveMedia("customer").video).toBe("/videos/hero-pour.mp4");
  });

  it("sub interfața de lucru a curierului nu se încarcă filmul de pe poartă", () => {
    // Regula 3 a rubricii, aplicată acolo unde doare cel mai tare: `ambient`
    // stă ore în șir sub degetul unui om aflat pe stradă, pe date mobile.
    // `hero-courier.mp4` are 4,15 MB — de trei ori bugetul — și era singura
    // media a sectorului, deci montarea lui `ambient` l-ar fi tras tăcut sub
    // bara de comandă, ca să se vadă la 8% opacitate.
    expect(resolveBackdropMedia("courier", "ambient").video).not.toBe("/videos/hero-courier.mp4");
    expect(resolveBackdropMedia("courier", "ambient").poster).toBeTruthy();
    // Poarta curierului (`hero`) rămâne neatinsă — acolo omul chiar se uită.
    expect(resolveBackdropMedia("courier", "hero").video).toBe("/videos/hero-courier.mp4");
  });

  it("assetul de `ambient` chiar încape în buget — măsurat pe fișier, nu promis", () => {
    // Regula 3 e o cifră, deci se probează cu o cifră. Un comentariu care spune
    // „sub 1,2 MB" nu oprește pe nimeni să pună mâine acolo un fișier de 4 MB;
    // testul ăsta da. Se uită la octeții de pe disc, nu la intenție.
    const BUGET_KB = 1200; // §3 din rubrică, ținta sectorului curier
    const media = resolveBackdropMedia("courier", "ambient");
    const kb = (p: string) => statSync(join(import.meta.dirname, "../../public", p)).size / 1024;

    const posterKb = kb(media.poster);
    const videoKb = media.video ? kb(media.video) : 0;
    expect(posterKb + videoKb, `ambient curier = ${Math.round(posterKb + videoKb)} KB`).toBeLessThan(
      BUGET_KB,
    );
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

  it("hero MĂRGINIT: atmosfera ține de deschidere, nu de fereastră", () => {
    // Gaura semnalată de trei valuri la rând (V3 pe /concierge la 1440, V6 —
    // „a treia oară" — și V7 pe /restaurants): `hero` era `fixed inset-0`, deci
    // acoperea fereastra ÎNTREAGĂ. Pe o pagină unde lista începe la mai puțin
    // de un ecran, atmosfera stă sub liste — exact ce interzice §6. Măsurat
    // înainte de reparație cu `scripts/hero-band.mjs`: 535px de listă peste
    // film la 1440×900, 266px la 390×844.
    //
    // Nivelul mărginit nu e un al patrulea nivel, ci o proprietate a lui
    // `hero`: aceeași atmosferă, dar întinsă peste blocul de deschidere din
    // pagină, nu peste tot ce se vede. Cine deține întinderea e MARCAJUL
    // paginii (blocul care înconjoară fundalul), nu o cifră ghicită aici — o
    // înălțime fixă ar fi mințit la prima schimbare de titlu sau de filtru.
    const marginit = planBackdrop("concierge", "hero", { ...motion, bounded: true });
    const intreg = planBackdrop("concierge", "hero", motion);

    expect(marginit.bounded).toBe(true);
    expect(intreg.bounded).toBe(false);

    // O bandă iese din ecran singură, odată cu pagina. Retragerea la scroll era
    // mecanismul care ținea locul mărginirii; ținute amândouă, atmosfera s-ar
    // stinge ÎNAINTE să iasă din cadru — adică fix în timp ce omul încă se uită
    // la deschidere.
    expect(marginit.fadesOnScroll).toBe(false);
    expect(intreg.fadesOnScroll).toBe(true);

    // Restul contractului rămâne neatins: o bandă e tot o deschidere, deci
    // aceeași podea de voal și aceeași media. Dacă mărginirea ar schimba și
    // culorile, n-ar mai fi aceeași atmosferă mutată, ci alta.
    expect(marginit.veilOpacity).toBe(intreg.veilOpacity);
    expect(marginit.mediaOpacity).toBe(intreg.mediaOpacity);
    expect(marginit.showVideo).toBe(intreg.showVideo);
  });

  it("mărginirea are sens doar la deschidere: `ambient` și `focus` o ignoră", () => {
    // `ambient` stă SUB o interfață de lucru — acolo fundalul are voie să țină
    // toată fereastra, fiindcă nu concurează cu nimic (8% opacitate). `focus` e
    // un moment de confirmare pe tot ecranul. O bandă în oricare din cele două
    // ar fi un dreptunghi cu muchii în mijlocul unei pagini de lucru.
    for (const intensity of ["ambient", "focus"] as Intensity[]) {
      expect(planBackdrop("courier", intensity, { ...motion, bounded: true }).bounded, intensity).toBe(
        false,
      );
    }
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

  it("fiecare voal stă peste podeaua măsurată pe FILM, nu pe poster", () => {
    // Podelele astea veneau din `veil-contrast.mjs`, care măsoară POSTERUL —
    // adică un cadru din 218. Testul trecea, dar nu apăra nimic: cerea 0.58 de
    // la flacără unde configul dădea 0.58, și ZERO de la cele două sushi. Un
    // prag pe care assetul îl atinge din construcție nu e o gardă, e o
    // formalitate — clasa de defect din §5 (comentariu/probă care minte).
    //
    // Acum vin din `node scripts/loop-compare.mjs public/videos/*.mp4`
    // (re-rulat 2026-08-16 pe assetele RE-ÎNCODATE de valul de performanță):
    // opacitatea minimă la care textul de corp (alb 70%) atinge 4.5:1 peste
    // percentila 95 a CELUI MAI LUMINOS cadru din tot loop-ul. Diferența nu e
    // teoretică — pe flacără posterul cerea 0.58 iar cadrul #27 cere 0.61, și
    // exact în secunda aia lista de beneficii de pe `/start/restaurant` pica
    // sub prag. Dacă schimbi un film, RE-RULEAZĂ unealta și adu cifra aici.
    //
    // Regula pe care o impune tabelul: UN ASSET, O PODEA. Aceeași flacără
    // trăia cu 0.58 în sectorul restaurant și 0.62 în concierge; același
    // `hero-sushi` cu 0.40 pe hub și 0.45 în concierge. De fiecare dată
    // suprafața cu podeaua mai mică era cea care mințea.
    const PODELE: Array<[string, number, number]> = [
      // [ce măsor, podea măsurată pe film (cadrul aprins), voalul din config]
      ["courier (hero-courier #101)", 0.51, planBackdrop("courier", "hero", motion).veilOpacity],
      ["restaurant (hero-flame #27)", 0.61, planBackdrop("restaurant", "hero", motion).veilOpacity],
      ["concierge (sector-concierge #118)", 0.25, planBackdrop("concierge", "hero", motion).veilOpacity],
      ["concierge/spa (sector-concierge #118)", 0.25, planBackdrop("concierge", "hero", motion, "spa").veilOpacity],
      ["concierge/sushi_bar (hero-sushi #153)", 0.42, planBackdrop("concierge", "hero", motion, "sushi_bar").veilOpacity],
      ["concierge/business_lounge (hero-lounge #215)", 0.29, planBackdrop("concierge", "hero", motion, "business_lounge").veilOpacity],
      // lumea „Restaurante" din concierge împrumută flacăra, deci și podeaua ei
      ["concierge/restaurant (hero-flame #27)", 0.61, planBackdrop("concierge", "hero", motion, "restaurant").veilOpacity],
      ["customer (hero-pour #188)", 0.6, planBackdrop("customer", "hero", motion).veilOpacity],
      ["customer/sushi hub (hero-sushi #153)", 0.42, planBackdrop("customer", "hero", motion, "sushi").veilOpacity],
    ];
    for (const [nume, podea, voal] of PODELE) {
      expect(voal, `${nume}: voal ${voal} sub podeaua măsurată ${podea}`).toBeGreaterThanOrEqual(podea);
    }
  });

  it("același fișier video are aceeași podea oriunde apare", () => {
    // Garda care lipsea. Podeaua ține de ASSET (cât de aprins e cel mai
    // luminos cadru al lui), nu de sectorul care se întâmplă să-l folosească —
    // deci două suprafețe care arată același film nu pot cere voaluri
    // diferite. Când o fac, cea mai mică e o promisiune ruptă în tăcere.
    const perFisier = new Map<string, Map<number, string[]>>();
    const noteaza = (sector: Sector, variant: string | null, eticheta: string) => {
      const media = resolveMedia(sector, variant);
      if (!media.video) return;
      const veil = planBackdrop(sector, "hero", motion, variant).veilOpacity;
      const grupuri = perFisier.get(media.video) ?? new Map<number, string[]>();
      grupuri.set(veil, [...(grupuri.get(veil) ?? []), eticheta]);
      perFisier.set(media.video, grupuri);
    };
    for (const sector of SECTOR_ORDER) {
      noteaza(sector, null, sector);
      for (const variant of Object.keys(SECTORS[sector].variants ?? {})) {
        noteaza(sector, variant, `${sector}/${variant}`);
      }
    }
    for (const [video, grupuri] of perFisier) {
      expect(
        [...grupuri.keys()],
        `${video} rulează cu voaluri diferite: ${[...grupuri]
          .map(([v, unde]) => `${v} (${unde.join(", ")})`)
          .join(" vs ")}`,
      ).toHaveLength(1);
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
