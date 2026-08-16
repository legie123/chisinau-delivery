import { describe, expect, it } from "vitest";
import {
  formatShiftDuration,
  shiftReachesTarget,
  SHIFT_TARGET_MIN,
  SHIFT_TARGET_MAX,
} from "@/app/(courier)/_lib/earnings";

// R2 (val adversarial 2) — cele două minciuni de pe ecranul de bani al
// curierului. Ambele au fost VĂZUTE în captură / DB, nu deduse din cod.
describe("formatShiftDuration", () => {
  // Tura reală a curierului semănat: 2026-08-13 11:23:59 → 22:23:44 UTC =
  // 659,76 minute. Codul vechi (floor pe ore + round pe restul) scria
  // „10h 60m" — un ceas imposibil, pe pagina de câștiguri.
  it("nu produce niciodată 60 de minute (tura de 659,76 min = 11h 0m)", () => {
    expect(formatShiftDuration("2026-08-13T11:23:59.361Z", "2026-08-13T22:23:44.898Z")).toBe("11h 0m");
  });

  it("rotunjește o singură dată, la minut (59m 45s = 1h 0m, nu 0h 60m)", () => {
    expect(formatShiftDuration("2026-01-01T08:00:00.000Z", "2026-01-01T08:59:45.000Z")).toBe("1h 0m");
  });

  it("sub o oră scrie doar minutele", () => {
    expect(formatShiftDuration("2026-01-01T08:00:00.000Z", "2026-01-01T08:42:00.000Z")).toBe("42m");
    expect(formatShiftDuration("2026-01-01T08:00:00.000Z", "2026-01-01T08:00:02.000Z")).toBe("0m");
  });

  it("păstrează orele întregi și restul lor", () => {
    expect(formatShiftDuration("2026-01-01T08:00:00.000Z", "2026-01-01T12:00:00.000Z")).toBe("4h 0m");
    expect(formatShiftDuration("2026-01-01T08:00:00.000Z", "2026-01-01T12:07:00.000Z")).toBe("4h 7m");
  });

  it("nu scrie durate negative dacă rândurile vin inversate", () => {
    expect(formatShiftDuration("2026-01-01T12:00:00.000Z", "2026-01-01T08:00:00.000Z")).toBe("0m");
  });
});

describe("shiftReachesTarget", () => {
  // Ținta e o PODEA pe ecranul curierului, nu o fereastră. Codul vechi aprindea
  // auriul doar în intervalul [600, 1000], deci o tură de 1500 MDL se randa mai
  // ștearsă decât una de 700 — banii care cresc arătau ca banii care scad.
  it("aprinde ținta și PESTE capătul de sus al benzii", () => {
    expect(shiftReachesTarget(SHIFT_TARGET_MAX + 500)).toBe(true);
    expect(shiftReachesTarget(1500)).toBe(true);
  });

  it("aprinde ținta exact la podea", () => {
    expect(shiftReachesTarget(SHIFT_TARGET_MIN)).toBe(true);
  });

  it("rămâne stinsă sub podea", () => {
    expect(shiftReachesTarget(SHIFT_TARGET_MIN - 0.01)).toBe(false);
    expect(shiftReachesTarget(0)).toBe(false);
  });
});
