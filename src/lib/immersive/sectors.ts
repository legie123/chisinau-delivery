// Lumea imersivă, pe sectoare. Un singur limbaj vizual — mătasea de dragon —
// recolorat și re-regizat pentru fiecare felie a conciergeriei. Deciziile de
// design (valul 2, 2026-08-16): prezență clară cu text pe plăci, regie proprie
// pe fiecare sector, tranziție lină între ele (aceeași pânză, alte culori).

export type SectorKey = "hub" | "restaurant" | "spa" | "business" | "curier" | "client";

export type SectorLook = {
  /** Culoarea de fond, în care se scufundă totul. */
  deep: [number, number, number];
  /** Lumina de pe creste — accentul care „aprinde" materialul. */
  rim: [number, number, number];
  /** Pulsul de dedesubt: vena care trece prin dragon. */
  pulse: [number, number, number];
  /** Scântei de jar: câte, cât de calde, cât de repede urcă. */
  embers: { count: number; rise: number; warmth: number };
  /** Regia de deschidere — ce face lumea în primele secunde. */
  intro: {
    /** Durata regiei, în secunde (cerința: 8-12s). */
    seconds: number;
    /** Cât de agitată e mătasea la început față de repausul de după. */
    turbulence: number;
    /** Cât de departe pornește camera; se apropie pe parcursul regiei. */
    distance: number;
  };
  /** Cât de tare respiră materialul după ce se așază regia. */
  restEnergy: number;
};

// Paleta de brand: navy #0a0a14, auriu #f5a623, roșu #e94560, jad pentru spa.
export const SECTOR_LOOKS: Record<SectorKey, SectorLook> = {
  // Hub — dragonul întreg: auriu dominant, puls roșu clar. Deschiderea cea mai
  // amplă, fiindcă e primul contact cu marca.
  hub: {
    deep: [0.039, 0.039, 0.078],
    rim: [0.961, 0.651, 0.137],
    pulse: [0.914, 0.271, 0.376],
    embers: { count: 90, rise: 0.055, warmth: 1.0 },
    intro: { seconds: 11, turbulence: 2.1, distance: 3.4 },
    restEnergy: 0.55,
  },
  // Restaurant — „se aprinde": jar viu, cele mai multe scântei, cel mai cald.
  restaurant: {
    deep: [0.055, 0.031, 0.043],
    rim: [0.976, 0.706, 0.243],
    pulse: [0.914, 0.271, 0.376],
    embers: { count: 130, rise: 0.075, warmth: 1.15 },
    intro: { seconds: 9, turbulence: 2.6, distance: 2.8 },
    restEnergy: 0.62,
  },
  // Spa — „se liniștește": jad rece, foarte puține scântei, mișcare lentă.
  spa: {
    deep: [0.031, 0.055, 0.051],
    rim: [0.541, 0.878, 0.741],
    pulse: [0.302, 0.686, 0.596],
    embers: { count: 34, rise: 0.022, warmth: 0.55 },
    intro: { seconds: 12, turbulence: 0.9, distance: 3.9 },
    restEnergy: 0.32,
  },
  // Sala de business — „se descuie": albastru rece cu auriu, ritm măsurat.
  business: {
    deep: [0.035, 0.047, 0.086],
    rim: [0.898, 0.749, 0.427],
    pulse: [0.361, 0.529, 0.788],
    embers: { count: 55, rise: 0.038, warmth: 0.8 },
    intro: { seconds: 10, turbulence: 1.4, distance: 3.2 },
    restEnergy: 0.42,
  },
  // Curier — noaptea orașului: albastru profund, scântei ca luminile străzii.
  curier: {
    deep: [0.027, 0.043, 0.078],
    rim: [0.984, 0.749, 0.376],
    pulse: [0.204, 0.596, 0.859],
    embers: { count: 75, rise: 0.09, warmth: 0.9 },
    intro: { seconds: 9, turbulence: 2.3, distance: 3.0 },
    restEnergy: 0.5,
  },
  // Client — masa: auriu cald, apropiat, primitor.
  client: {
    deep: [0.047, 0.035, 0.055],
    rim: [0.969, 0.678, 0.204],
    pulse: [0.878, 0.361, 0.404],
    embers: { count: 100, rise: 0.05, warmth: 1.05 },
    intro: { seconds: 10, turbulence: 1.9, distance: 3.1 },
    restEnergy: 0.55,
  },
};

/**
 * Ce sector arată o rută. Doar vitrinele și porțile primesc fundal (decizia din
 * valul 1: 8 pagini); pentru tot ce ține de operare — panouri, coș, checkout,
 * ecranul curierului în livrare — întoarcem null și nu se montează nimic.
 */
export function sectorForPath(pathname: string, search?: string): SectorKey | null {
  if (pathname === "/") return "hub";
  if (pathname === "/start/client") return "client";
  if (pathname === "/start/curier") return "curier";
  if (pathname === "/start/restaurant") return "restaurant";
  if (pathname === "/restaurants") return "restaurant";
  if (/^\/restaurants\/[^/]+$/.test(pathname)) return "restaurant";
  if (pathname === "/concierge") {
    const tip = new URLSearchParams(search ?? "").get("tip");
    if (tip === "spa" || tip === "wellness_lounge") return "spa";
    if (tip === "sushi_bar" || tip === "restaurant") return "restaurant";
    return "business";
  }
  if (/^\/concierge\/[^/]+$/.test(pathname)) return "business";
  return null;
}
