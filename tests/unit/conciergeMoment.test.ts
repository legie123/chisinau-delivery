import { statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SECTORS, planBackdrop, resolveBackdropMedia, resolveMedia } from "@/components/immersive/sectors";
import { VENUE_ORDER } from "@/lib/concierge/venues";

// Valul V6 — sectorul concierge. Ce se poate proba aici e contractul: ce asset
// primește fiecare lume, cât cântărește, ce voal duce cu el și cum se comportă
// semnalul momentului de confirmare. Cum ARATĂ rămâne treaba capturilor.

const store = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal("window", { dispatchEvent: () => true, Event: class {} });

const { markBookingConfirmed, consumeBookingConfirmed } = await import(
  "@/components/customer/BookingConfirmedFocus"
);

describe("concierge — lumile și greutatea lor", () => {
  const kb = (p: string) => statSync(join(process.cwd(), "public", p)).size / 1024;

  it("fiecare tip de locație din meniu are o lume în contract", () => {
    // Dacă cineva adaugă un tip de locație (a șasea cameră), aici află că
    // fundalul lui cade tăcut pe cel implicit, în loc s-o descopere în captură.
    for (const type of VENUE_ORDER) {
      expect(SECTORS.concierge.variants?.[type], `${type} fără lume proprie`).toBeTruthy();
    }
  });

  it("`ambient` pe pagina locului nu trage niciun film — 33 KB, nu 2,7 MB", () => {
    // Regula 3, în locul unde a fost cel mai ușor de încălcat: pagina locului e
    // o suprafață de răsfoire, iar `resolveMedia` pentru lumea „sală de
    // business" duce un film de 2,73 MB. `ambient` îl ocolește prin poster.
    const ambient = resolveBackdropMedia("concierge", "ambient");
    expect(ambient.video).toBeUndefined();
    expect(kb(ambient.poster)).toBeLessThan(120);
  });

  it("loop-ul propriu de sector chiar încape în bugetul de 1,5 MB", () => {
    const hero = resolveMedia("concierge");
    expect(hero.video).toBe("/videos/sector-concierge.mp4");
    expect(kb(hero.video!) + kb(hero.poster), "loop concierge").toBeLessThan(1500);
  });

  it("lumile cu asset luminos își duc propria podea de voal", () => {
    // Numerele vin din `scripts/loop-compare.mjs`, măsurate pe cel mai luminos
    // cadru al fiecărui film: sushi cere 0.42, flacăra 0.61. Voalul sectorului
    // (0.40) nu le acoperă, deci varianta trebuie să-l ridice ea.
    const motion = { motionOk: true, hasVideo: true };
    expect(planBackdrop("concierge", "hero", motion, "sushi_bar").veilOpacity).toBeGreaterThanOrEqual(0.42);
    expect(planBackdrop("concierge", "hero", motion, "restaurant").veilOpacity).toBeGreaterThanOrEqual(0.61);
    // Lumile întunecate rămân subțiri — voalul nu se ridică „ca să fim siguri",
    // fiindcă fiecare zecime în plus stinge exact atmosfera plătită cu credite.
    expect(planBackdrop("concierge", "hero", motion, "spa").veilOpacity).toBeLessThanOrEqual(0.4);
  });
});

describe("momentul rezervării confirmate", () => {
  beforeEach(() => store.clear());

  it("poartă lumea locului confirmat, nu pe a filtrului", () => {
    markBookingConfirmed("spa");
    expect(consumeBookingConfirmed()).toEqual({ variant: "spa" });
  });

  it("se consumă o singură dată — altfel s-ar reaprinde la fiecare re-randare", () => {
    markBookingConfirmed("business_lounge");
    expect(consumeBookingConfirmed()).toEqual({ variant: "business_lounge" });
    expect(consumeBookingConfirmed()).toBeNull();
  });

  it("un tip necunoscut nu aprinde o lume greșită, ci cade pe cea implicită", () => {
    markBookingConfirmed("cinema");
    expect(consumeBookingConfirmed()).toEqual({ variant: null });
  });

  it("fără semnal nu există moment", () => {
    expect(consumeBookingConfirmed()).toBeNull();
  });

  it("storage-ul mut nu rupe confirmarea rezervării", () => {
    // Mod privat vechi / cotă plină: `sessionStorage` aruncă. O rezervare
    // confirmată nu are voie să pice pentru că nu s-a putut aprinde un fundal.
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new Error("QuotaExceeded"); },
      setItem: () => { throw new Error("QuotaExceeded"); },
      removeItem: () => {},
    });
    expect(() => markBookingConfirmed("spa")).not.toThrow();
    expect(consumeBookingConfirmed()).toBeNull();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it("`focus` stă sub conținut și se stinge singur (lecția plătită în V5)", () => {
    const plan = planBackdrop("concierge", "focus", { motionOk: true, hasVideo: true });
    expect(plan.holdMs).toBe(2000);
    expect(plan.mediaOpacity).toBeLessThan(0.2);
    expect(plan.drift).toBe(false);
  });
});
