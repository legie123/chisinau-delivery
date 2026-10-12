// Parity row 16a: a restaurant that is closed NOW but accepts orders and opens later can still take a
// SCHEDULED order (place_order checks restaurant_open_at at the requested time). The menu lets the
// customer add, the cart forces "Programează" while the restaurant is closed.
import { describe, expect, it } from "vitest";
import { canOrderAhead } from "../src/lib/browse";
import type { Restaurant } from "../src/types";

const r = (over: Partial<Restaurant>): Restaurant => ({
  id: "r", slug: "r", name: "R", cuisine: "sushi", venueType: "restaurant", category: "Sushi", address: "",
  lat: null, lng: null, logoUrl: null, coverUrl: null, ratingAvg: null, ratingCount: 0, prepLabel: "", deliveryFee: 0,
  minOrder: 0, acceptingOrders: true, openNow: false, nextOpening: "mâine la 10:00", distanceM: null,
  acceptsCatering: false, cateringMin: null, deliversHere: null, ...over,
});

describe("canOrderAhead", () => {
  it("closed now, accepting, opens later -> schedule allowed", () => {
    expect(canOrderAhead(r({}))).toBe(true);
  });
  it("open now -> not 'ahead' (normal ordering)", () => {
    expect(canOrderAhead(r({ openNow: true, nextOpening: null }))).toBe(false);
  });
  it("paused by the partner, or no future hours -> no", () => {
    expect(canOrderAhead(r({ acceptingOrders: false }))).toBe(false);
    expect(canOrderAhead(r({ nextOpening: null }))).toBe(false);
  });
});
