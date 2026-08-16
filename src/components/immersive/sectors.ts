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
export type SectorMedia = { video?: string; poster: string; veil?: number };

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
  },
  restaurant: {
    note: "căldură de cuptor pe margini, centrul curat ca să respire datele; cel mai discret din patru",
    accent: "#f5a623",
    // Cel mai luminos asset din set — flacăra ocupă jumătate de cadru la
    // saturație maximă, deci și cea mai înaltă podea măsurată (0.58). Captura
    // de dinainte de V3 (`/start/restaurant`, 390×844) arată subtitlul și cele
    // patru rânduri de beneficii direct pe portocaliu: 2.76:1, adică exact
    // „textul se citește din noroc" pe care regula 1 îl interzice.
    veil: 0.58,
    ambientOpacity: 0.05,
    gradient: `radial-gradient(120% 80% at 50% 0%, #4a350f 0%, ${NAVY} 62%)`,
    driftScale: 1.06,
    media: { video: "/videos/hero-flame.mp4", poster: "/videos/hero-flame-poster.jpg" },
  },
  concierge: {
    note: "lounge la ora albastră; fundalul urmează tipul locației alese din filtru",
    accent: "#d4af37",
    // Lounge/spa/sushi sunt assete întunecate: la 0.35 textul de corp e deja la
    // 5.87-6.50:1. Aici voalul rămâne subțire — §5 spune că sectorul ăsta are
    // cel mai mult drept la atmosferă. Excepția e lumea „Restaurante", care
    // împrumută flacăra și își duce propria podea (vezi `variants`).
    veil: 0.4,
    ambientOpacity: 0.06,
    gradient: `radial-gradient(120% 80% at 50% 0%, #1a2f3d 0%, ${NAVY} 62%)`,
    driftScale: 1.09,
    media: { video: "/videos/hero-lounge.mp4", poster: "/videos/hero-lounge-poster.jpg" },
    variants: {
      business_lounge: { video: "/videos/hero-lounge.mp4", poster: "/videos/hero-lounge-poster.jpg" },
      spa: { video: "/videos/hero-spa.mp4", poster: "/videos/hero-spa-poster.jpg" },
      wellness_lounge: { video: "/videos/hero-spa.mp4", poster: "/videos/hero-spa-poster.jpg" },
      sushi_bar: { video: "/videos/hero-sushi.mp4", poster: "/videos/hero-sushi-poster.jpg" },
      restaurant: { video: "/videos/hero-flame.mp4", poster: "/videos/hero-flame-poster.jpg", veil: 0.58 },
    },
  },
  customer: {
    note: "întuneric cald, mâncarea e eroul; video doar pe hero, niciodată sub liste",
    accent: "#e94560",
    // Turnatul din pahar e luminos (3.20:1 la 0.35); sushi-ul hub-ului e
    // întunecat și n-are nevoie de aceeași podea — de-aia varianta o coboară.
    veil: 0.55,
    ambientOpacity: 0.06,
    gradient: `radial-gradient(120% 80% at 50% 0%, #3d1220 0%, ${NAVY} 62%)`,
    driftScale: 1.07,
    media: { video: "/videos/hero-pour.mp4", poster: "/videos/hero-pour-poster.jpg" },
    variants: {
      // Hub-ul (`/`) e primul contact cu brandul: sushi, nu turnatul din pahar.
      sushi: { video: "/videos/hero-sushi.mp4", poster: "/videos/hero-sushi-poster.jpg", veil: 0.4 },
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
      mediaOpacity: 0.55,
      veilOpacity: 0.15,
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
