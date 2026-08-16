// Contractul imersiv al platformei — secțiunea 2 din
// `docs/DESIGN-IMERSIV-4-SECTOARE.md`. Un singur fișier de configurație pentru
// toate cele patru sectoare, ca atmosfera să nu se mai inventeze la fiecare
// pagină (înainte de valul ăsta, fundalul video trăia direct în trei pagini și
// într-un component de hero, fiecare cu propriile numere).
//
// Culorile NU sunt inventate aici: substratul `#0a0a14`, tentele per sector și
// accentele vin din `docs/design/dragons-dna.json` (paleta „Dragons Alliance
// Premium") și din tentele deja folosite pe porțile hub-ului.

export type Sector = "courier" | "restaurant" | "concierge" | "customer";

/** `ambient` = fundal liniștit sub UI de lucru · `hero` = deschiderea unui
 *  ecran, o singură dată · `focus` = moment de confirmare, ține 2s și se stinge. */
export type Intensity = "ambient" | "hero" | "focus";

/** Video-ul e opțional; posterul nu. Un sector fără video încă generat trebuie
 *  să arate corect, nu gol — de-aia posterul e obligatoriu prin tip.
 *  `veil` e o podea proprie assetului: două lumi din același sector pot avea
 *  luminozități foarte diferite (concierge are și lounge la ora albastră, și
 *  bucătărie în flăcări), iar o singură cifră ar pedepsi-o pe cea întunecată. */
export type SectorMedia = {
  video?: string;
  poster: string;
  veil?: number;
  /** Varianta pentru ecran LAT, când assetul principal e vertical.
   *
   *  `object-cover` nu decupează doar — și mărește. Un cadru 720×1280 pus într-o
   *  fereastră 1440×900 e scalat de două ori și tăiat la o fâșie îngustă:
   *  pe telefon se vede strada întreagă, pe desktop rămâne o pastă neclară.
   *  Capturile comparative au arătat exact asta, deci fiecare format îl
   *  primește pe al lui în loc să pretindem că unul singur acoperă ambele. */
  wide?: { video?: string; poster: string };
};

export type SectorConfig = {
  /** doar pentru citit codul și pentru QA — nu ajunge niciodată în UI */
  note: string;
  /** accentul atmosferic al sectorului (nu o culoare de stare) */
  accent: string;
  /** Opacitatea voalului navy la `hero`, calibrată pe posterul propriu cu
   *  `scripts/veil-contrast.mjs` — nu ghicită. Ținta e textul de corp
   *  (alb 70%) peste percentila 95 a luminanței din banda unde stă textul:
   *  pixelul aprins decide lizibilitatea, nu media. Assetele întunecate
   *  (lounge, spa, sushi) trec deja la 0.35 și rămân acolo; cele luminoase
   *  (flacără, stradă la amurg, turnat) urcă până trec de 4.5:1.
   *  O variantă își poate duce propria podea — vezi `SectorMedia.veil`. */
  veil: number;
  /** cât din media se vede la `ambient` (rubrica: curier 8%, restaurant 5%) */
  ambientOpacity: number;
  /** ultimul din lanțul de fallback: se vede chiar dacă posterul dă 404 */
  gradient: string;
  /** Amplitudinea derivei lente — scale-ul final al mișcării de fundal.
   *  Curierul e deja în mișcare în realitate, deci fundalul lui respiră cel
   *  mai puțin; lounge-ul are voie să se apropie lent. */
  driftScale: number;
  media: SectorMedia;
  /** Ce are voie să se încarce SUB o interfață de lucru (`ambient`).
   *
   *  `media` e ales pentru deschiderea unui ecran, unde un video mare se
   *  amortizează: omul se uită la el. `ambient` e altceva — stă ore în șir sub
   *  degetul cuiva care lucrează, pe date mobile, și nu se uită nimeni la el.
   *  Regula 3 a rubricii („un asset care nu se încarcă în 2 secunde pe 4G nu
   *  există", buget 1,5 MB) se aplică aici cel mai tare, iar `hero-courier.mp4`
   *  are 4,15 MB — de trei ori bugetul. Fără separarea asta, montarea lui
   *  `ambient` ar fi însemnat exact asta: 4 MB de film sub bara de comandă a
   *  unui om aflat pe stradă, ca să se vadă la 8% opacitate.
   *
   *  Lipsește ⇒ `ambient` folosește `media`, ca înainte. */
  ambientMedia?: SectorMedia;
  /** lumi din interiorul aceluiași sector (concierge: tipul locației) */
  variants?: Record<string, SectorMedia>;
};

const NAVY = "#0a0a14";

export const SECTORS: Record<Sector, SectorConfig> = {
  courier: {
    note: "noaptea orașului — asfalt umed, lumini defocalizate; auriul rămâne exclusiv pentru bani",
    accent: "#f5a623",
    // Măsurat pe posterul propriu (`scripts/veil-contrast.mjs`): la 0.35 textul
    // de corp (alb 70%) stă la 3.47:1. La 0.55 urcă la 5.05:1.
    veil: 0.55,
    ambientOpacity: 0.08,
    gradient: `radial-gradient(115% 78% at 50% 0%, #16213e 0%, ${NAVY} 58%)`,
    driftScale: 1.04,
    media: { video: "/videos/hero-courier.mp4", poster: "/videos/hero-courier-poster.jpg" },
    // Loop propriu pentru suprafața de lucru, generat cu promptul din §3 al
    // rubricii: 685 KB + poster 40 KB, adică sub bugetul de 1,2 MB al
    // sectorului și de șase ori mai ușor decât filmul de pe poartă (4,15 MB),
    // care rămâne unde omul chiar se uită la el (`/start/curier`).
    //
    // Bate posterul vechi din două motive verificabile, nu de gust: e VERTICAL
    // (720×1280), deci pe telefon se vede cadrul întreg în loc de o decupare
    // din mijlocul unui 16:9 — exact pata neclară de la 390×844 — și e la
    // persoana întâi, fără chip. Vechiul asset are un curier cu fața spre
    // cameră: pus sub datele curierului real, îi punea un străin în spatele
    // propriilor cifre.
    ambientMedia: {
      video: "/videos/sector-courier.mp4",
      poster: "/videos/sector-courier-poster.jpg",
      // Pe desktop rămâne cadrul orizontal deja existent — arată bine acolo
      // (verificat în capturi) și, fiind doar poster, nu trage niciodată cele
      // 4,15 MB ale filmului de pe poartă. Sectorul curier e oricum un ecran
      // de telefon: „om pe stradă, cu o singură mână liberă" (§3).
      wide: { poster: "/videos/hero-courier-poster.jpg" },
    },
  },
  restaurant: {
    note: "căldură de cuptor pe margini, centrul curat ca să respire datele; cel mai discret din patru",
    accent: "#f5a623",
    // Cel mai luminos asset din set — flacăra ocupă jumătate de cadru la
    // saturație maximă, deci și cea mai înaltă podea din tot contractul.
    //
    // 0.58 era măsurat pe POSTER, adică pe un cadru din 218, iar posterul e
    // dintre cele întunecate. `loop-compare.mjs` le trece pe toate: cadrul cel
    // mai aprins e #27 și cere 0.61. Diferența nu e cosmetică — măsurată pe
    // ecranul viu la cadrul ăla (`/start/restaurant`, 390×844, filmul înghețat
    // la 1.125 s), lista de beneficii stătea la 1.59:1 și eticheta aurie la
    // 4.09:1, deci exact „textul se citește din noroc" pe care regula 1 îl
    // interzice — doar că norocul ține de secunda în care te uiți.
    //
    // Aceeași flacără trăia deja cu DOUĂ podele diferite în același fișier:
    // varianta `restaurant` din concierge o are la 0.62 (V6 a măsurat-o corect
    // pe film), iar sectorul restaurant rămăsese la cifra de pe poster. Un
    // asset, o podea — 0.62, rotunjit în sus de la 0.61 ca în V6.
    veil: 0.62,
    ambientOpacity: 0.05,
    gradient: `radial-gradient(120% 80% at 50% 0%, #4a350f 0%, ${NAVY} 62%)`,
    driftScale: 1.06,
    media: { video: "/videos/hero-flame.mp4", poster: "/videos/hero-flame-poster.jpg" },
  },
  concierge: {
    note: "lounge la ora albastră; fundalul urmează tipul locației alese din filtru",
    accent: "#d4af37",
    // Voalul sectorului rămâne subțire — §5 spune că aici atmosfera are cel mai
    // mult drept la existență — dar podeaua nu mai vine de la poster.
    //
    // `veil-contrast.mjs` măsoară UN cadru (posterul) și tocmai de-aia trecuse
    // totul: pe postere, lounge/spa/sushi dădeau 5.87-6.50:1 la 0.35. Filmele au
    // însă 216 cadre, iar `loop-compare.mjs` (V6) le măsoară pe toate: spa urcă
    // de la 0.085 la 0.479 luminanță în ultima secundă — se aprind prosoapele
    // albe și orhideea — deci textul de corp cădea la 3.25:1 exact în secunda
    // aia. Podeaua e acum a celui mai luminos cadru din loop, nu a unuia ales.
    veil: 0.4,
    ambientOpacity: 0.06,
    gradient: `radial-gradient(120% 80% at 50% 0%, #1a2f3d 0%, ${NAVY} 62%)`,
    driftScale: 1.09,
    // Loop propriu de sector (§5), generat cu promptul din rubrică și păstrat
    // fiindcă a bătut măsurat ambii deținători, nu fiindcă e nou: 0,36 MB față
    // de 2,73/2,48 (singurul din trei care încape în bugetul de 1,5 MB al
    // regulii 3), cusătură de loop 6,7 față de 13,4/18,3, derivă 0,24 față de
    // 1,42/1,12 (regula 4 cere mișcare lentă) și podea de voal 0,25 față de
    // 0,29/0,56. Dovada în `docs/DESIGN-IMERSIV-4-SECTOARE.md` §5.
    media: { video: "/videos/sector-concierge.mp4", poster: "/videos/sector-concierge-poster.jpg" },
    // Pagina unui loc (`ambient`) primește DOAR posterul, 33 KB. Motivul e că
    // `ambient` nu poate urma lumea fără să mintă bugetul: trei din cele patru
    // filme rămase (flacără 2,92 · lounge 2,73 · sushi 1,50) sunt peste sau la
    // limita regulii 3, iar un fundal de 2,7 MB tras la 6% opacitate sub o
    // pagină de răsfoire e exact greșeala pe care sectorul curier a evitat-o.
    // Lumea contează la INTRARE, unde se vede întreagă (`hero`, /concierge) —
    // acolo o urmează în continuare, prin `variants`. Când V9 reîncarcă filmele
    // rămase sub buget, linia asta poate deveni per-lume fără alt cost.
    ambientMedia: { poster: "/videos/sector-concierge-poster.jpg" },
    variants: {
      // Sala de business rămâne pe filmul vechi, deși e de 7,6 ori mai greu
      // decât noul asset: candidatul e un bazin termal cu aburi, iar sub
      // filtrul „Săli de business" ar fi fost fix eticheta care minte din
      // regula 5. Greutatea lui e problema lui V9, nu un motiv de a-i schimba
      // înțelesul. Podea măsurată 0.29 — trece la voalul sectorului (5.28:1).
      business_lounge: { video: "/videos/hero-lounge.mp4", poster: "/videos/hero-lounge-poster.jpg" },
      // Spa și wellness trec pe noul loop: bazinul termal cu aburi E un spa,
      // deci nu se pierde niciun înțeles, și se repară singurul contrast căzut
      // din sector (3.25:1 → 5.47:1 la același voal).
      spa: { video: "/videos/sector-concierge.mp4", poster: "/videos/sector-concierge-poster.jpg" },
      wellness_lounge: { video: "/videos/sector-concierge.mp4", poster: "/videos/sector-concierge-poster.jpg" },
      // Sushi-ul are propriul înțeles și rămâne, dar își duce propria podea:
      // vârful lui de luminanță (0.268 @cadru 152) cere 0.42, iar la voalul
      // sectorului textul stătea la 4.40:1 — sub prag cu o unitate zecimală,
      // adică exact genul de ratare pe care media o ascunde.
      sushi_bar: { video: "/videos/hero-sushi.mp4", poster: "/videos/hero-sushi-poster.jpg", veil: 0.45 },
      // Flacăra: podeaua măsurată pe film e 0.61, nu 0.58 cât ținea posterul.
      restaurant: { video: "/videos/hero-flame.mp4", poster: "/videos/hero-flame-poster.jpg", veil: 0.62 },
    },
  },
  customer: {
    note: "întuneric cald, mâncarea e eroul; video doar pe hero, niciodată sub liste",
    accent: "#e94560",
    // Turnatul din pahar e luminos. 0.55 venea tot de pe poster; pe film,
    // cadrul cel mai aprins e #188 și cere 0.60 (`loop-compare.mjs`). Ridicat
    // la 0.61 din același motiv ca flacăra — podeaua se ia de pe cel mai prost
    // cadru, nu de pe cel ales ca poster.
    veil: 0.61,
    ambientOpacity: 0.06,
    gradient: `radial-gradient(120% 80% at 50% 0%, #3d1220 0%, ${NAVY} 62%)`,
    driftScale: 1.07,
    media: { video: "/videos/hero-pour.mp4", poster: "/videos/hero-pour-poster.jpg" },
    variants: {
      // Hub-ul (`/`) e primul contact cu brandul: sushi, nu turnatul din pahar.
      // Podea 0.45, nu 0.40: e ACELAȘI fișier pe care concierge îl folosește la
      // filtrul „Sushi bar", iar acolo V6 îi măsurase deja 0.42 pe film și îi
      // pusese 0.45. Un asset trăia deci cu două podele, iar hub-ul o avea pe
      // cea mai mică — exact defectul pentru care a fost scris valul ăsta, doar
      // că în celălalt sector. Un asset, o podea.
      sushi: { video: "/videos/hero-sushi.mp4", poster: "/videos/hero-sushi-poster.jpg", veil: 0.45 },
    },
  },
};

export const SECTOR_ORDER: Sector[] = ["courier", "restaurant", "concierge", "customer"];

/** Media efectivă: varianta cerută dacă există, altfel media sectorului. */
export function resolveMedia(sector: Sector, variant?: string | null): SectorMedia {
  const cfg = SECTORS[sector];
  if (variant && cfg.variants?.[variant]) return cfg.variants[variant];
  return cfg.media;
}

/** Media efectivă pentru un NIVEL. `ambient` poate cere un asset mai ieftin
 *  decât deschiderea de ecran (vezi `SectorConfig.ambientMedia`) — un sector
 *  care nu declară unul se comportă exact ca înainte. */
export function resolveBackdropMedia(
  sector: Sector,
  intensity: Intensity,
  variant?: string | null,
): SectorMedia {
  const cfg = SECTORS[sector];
  if (intensity === "ambient" && cfg.ambientMedia) return cfg.ambientMedia;
  return resolveMedia(sector, variant);
}

export type BackdropPlan = {
  /** cât de vizibilă e imaginea/video-ul peste gradient */
  mediaOpacity: number;
  /** voalul navy dintre atmosferă și text — regula 1: contrast prin strat, nu prin noroc */
  veilOpacity: number;
  showVideo: boolean;
  drift: boolean;
  /** amplitudinea derivei; 1 = static (mișcarea oprită sau `focus`) */
  driftScale: number;
  preload: "auto" | "none";
  /** `hero` se stinge după primul ecran, ca listele să nu stea peste film */
  fadesOnScroll: boolean;
  /** `focus`: cât ține momentul înainte să se stingă singur */
  holdMs: number | null;
};

/** Toată decizia de nivel, într-o funcție pură — ca s-o poată proba un test în
 *  loc s-o creadă pe cuvânt (`tests/unit/sectorBackdrop.test.ts`). */
export function planBackdrop(
  sector: Sector,
  intensity: Intensity,
  env: { motionOk: boolean; hasVideo: boolean },
  variant?: string | null,
): BackdropPlan {
  const cfg = SECTORS[sector];
  const showVideo = env.motionOk && env.hasVideo;
  // Lumea aleasă își poate cere propria podea de voal; altfel o moștenește pe
  // a sectorului. Fără asta, filtrul „Restaurante" din concierge ar arăta
  // flacăra sub voalul subțire al lounge-ului.
  const veil = resolveMedia(sector, variant).veil ?? cfg.veil;

  if (intensity === "ambient") {
    return {
      mediaOpacity: cfg.ambientOpacity,
      veilOpacity: 0.2,
      showVideo,
      drift: env.motionOk,
      driftScale: env.motionOk ? cfg.driftScale : 1,
      preload: "none",
      fadesOnScroll: false,
      holdMs: null,
    };
  }

  if (intensity === "focus") {
    return {
      // Prima montare pe un ecran real (V5, cursa acceptată) a arătat că
      // valorile de dinainte — media la 0.55, peste conținut — nu erau un
      // moment de confirmare, ci o eclipsă: fotografia acoperea complet
      // livrarea tocmai acceptată, iar timp de 2 secunde curierul nu mai vedea
      // nici adresa, nici butonul. Regula 1 spune exact invers („atmosfera stă
      // în spate, comanda stă în față"), iar o confirmare care ascunde chiar
      // lucrul pe care îl confirmă e mai rea decât lipsa ei.
      //
      // Acum e o RESPIRAȚIE, nu un capac: fundalul urcă scurt peste nivelul
      // `ambient` (0.08 → 0.16, deci se simte că s-a întâmplat ceva), voalul
      // rămâne gros ca textul să nu piardă contrast, iar accentul cald de pe
      // margini dă pulsul. Totul dedesubt, niciodată peste conținut.
      mediaOpacity: 0.16,
      veilOpacity: 0.3,
      showVideo,
      drift: false,
      driftScale: 1,
      preload: "auto",
      fadesOnScroll: false,
      holdMs: 2000,
    };
  }

  return {
    mediaOpacity: 1,
    veilOpacity: veil,
    showVideo,
    drift: env.motionOk,
    driftScale: env.motionOk ? cfg.driftScale : 1,
    preload: "auto",
    fadesOnScroll: true,
    holdMs: null,
  };
}
