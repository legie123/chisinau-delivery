// Parity rows 16b/16c: the cart checks the chosen address against the restaurant's delivery radius
// BEFORE the customer taps "Plasează" (place_order refuses it anyway, sim 102). Which pin counts:
// the new address' pin, a saved address' own pin, or the pin just placed on an old pinless address.
import { describe, expect, it } from "vitest";
import { effectiveDeliveryPin } from "../src/lib/checkout";

const p1 = { lat: 47.02, lng: 28.83 };
const p2 = { lat: 47.03, lng: 28.84 };

describe("effectiveDeliveryPin", () => {
  it("new address -> the map pin", () => {
    expect(effectiveDeliveryPin("new", undefined, p1, null)).toEqual(p1);
    expect(effectiveDeliveryPin("new", undefined, null, null)).toBeNull();
  });
  it("saved address with a pin -> its own pin", () => {
    expect(effectiveDeliveryPin("a1", { lat: 47.03, lng: 28.84 }, p1, null)).toEqual(p2);
  });
  it("saved address without a pin -> the pin placed now, else unknown", () => {
    expect(effectiveDeliveryPin("a1", { lat: null, lng: null }, null, p1)).toEqual(p1);
    expect(effectiveDeliveryPin("a1", { lat: null, lng: null }, null, null)).toBeNull();
  });
});
