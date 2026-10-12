// C1 on Home: restaurants that do not deliver to the customer's pin (restaurants_delivering_to, the
// place_order radius rule, sim 102) sink to the end of every list, in any sort; unknown (no pin,
// signed out) keeps the normal order.
import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER, filterRestaurants } from "../src/lib/browse";
import type { Restaurant } from "../src/types";

function r(id: string, over: Partial<Restaurant> = {}): Restaurant {
  return {
    id, slug: id, name: id, cuisine: "sushi", venueType: "restaurant", category: "Sushi", address: "",
    lat: null, lng: null, logoUrl: null, coverUrl: null, ratingAvg: null, ratingCount: 0, prepLabel: "25–40 min",
    deliveryFee: 0, minOrder: 0, acceptingOrders: true, openNow: true, nextOpening: null, distanceM: null,
    acceptsCatering: false, cateringMin: null, deliversHere: null, ...over,
  };
}
const ids = (list: Restaurant[]) => list.map((x) => x.id);

describe("delivery zone on Home", () => {
  it("out-of-zone restaurants go last, order kept inside each group", () => {
    const list = [r("far1", { deliversHere: false }), r("a", { deliversHere: true }), r("far2", { deliversHere: false }), r("b", { deliversHere: true })];
    expect(ids(filterRestaurants(list, DEFAULT_FILTER))).toEqual(["a", "b", "far1", "far2"]);
  });

  it("also under the rating sort", () => {
    const list = [r("far", { deliversHere: false, ratingAvg: 5, ratingCount: 9 }), r("near", { deliversHere: true, ratingAvg: 3, ratingCount: 9 })];
    expect(ids(filterRestaurants(list, { ...DEFAULT_FILTER, sort: "rating" }))).toEqual(["near", "far"]);
  });

  it("unknown zone (no pin yet) changes nothing", () => {
    const list = [r("z", { deliversHere: null }), r("a", { deliversHere: null })];
    expect(ids(filterRestaurants(list, DEFAULT_FILTER))).toEqual(["z", "a"]);
  });
});
