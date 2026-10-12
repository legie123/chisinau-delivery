// "Epuizat" on the customer menu: same rule as place_order (20261012000102) — sold out while
// sold_out_until is later than now; 'infinity' = until the kitchen switches it back.
import { describe, expect, it } from "vitest";
import { isSoldOut, liveAvailability } from "../src/lib/browse";

const now = Date.parse("2026-10-12T10:00:00Z");

describe("isSoldOut", () => {
  it("future instant, 'infinity' → sold out; null, past, now → available", () => {
    expect(isSoldOut("2026-10-12T21:00:00+00:00", now)).toBe(true);
    expect(isSoldOut("infinity", now)).toBe(true);
    expect(isSoldOut(null, now)).toBe(false);
    expect(isSoldOut("2026-10-12T09:59:00Z", now)).toBe(false);
    expect(isSoldOut("2026-10-12T10:00:00Z", now)).toBe(false);
  });
});

describe("liveAvailability (cart reconciliation)", () => {
  it("a sold-out line is unavailable, so the cart names it instead of failing at checkout", () => {
    expect(liveAvailability({ id: "a", price_mdl: 10, is_available: true, sold_out_until: "infinity" }, now)).toEqual({
      id: "a", price_mdl: 10, is_available: false,
    });
    expect(liveAvailability({ id: "b", price_mdl: 10, is_available: true, sold_out_until: null }, now).is_available).toBe(true);
    expect(liveAvailability({ id: "c", price_mdl: 10, is_available: false, sold_out_until: null }, now).is_available).toBe(false);
  });
});
