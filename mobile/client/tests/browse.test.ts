// Home/Search browse rules (web RestaurantBrowser parity) + login error mapping.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTER,
  filterRestaurants,
  isDefaultFilter,
  isStale,
  popularRestaurants,
  sortRestaurants,
  STALE_AFTER_MS,
} from "../src/lib/browse";
import { loginErrorText } from "../src/lib/errors";
import type { Restaurant } from "../src/types";

function r(id: string, over: Partial<Restaurant> = {}): Restaurant {
  return {
    id, slug: id, name: id, cuisine: "sushi", venueType: "restaurant", category: "Sushi · Japonez", address: "",
    lat: null, lng: null, logoUrl: null, coverUrl: null, ratingAvg: null, ratingCount: 0, prepLabel: "25–40 min",
    deliveryFee: 0, minOrder: 0, acceptingOrders: true, openNow: true, nextOpening: null, distanceM: null,
    acceptsCatering: false, cateringMin: null, deliversHere: null, ...over,
  };
}

const ids = (list: Restaurant[]) => list.map((x) => x.id);

describe("filterRestaurants", () => {
  const list = [
    r("sakura", { name: "Sakura", openNow: true }),
    r("closed", { name: "Nobu", openNow: false }),
    r("paused", { name: "Kaito", acceptingOrders: false }),
    r("fine", { name: "Gastro", cuisine: "fine_dining", category: "Fine Dining", acceptsCatering: true }),
  ];

  it("Deschis acum keeps only places that take orders now (hours AND manual switch)", () => {
    expect(ids(filterRestaurants(list, { ...DEFAULT_FILTER, openNowOnly: true }))).toEqual(["sakura", "fine"]);
  });

  it("Catering is a category of its own (accepts_catering), not a cuisine", () => {
    expect(ids(filterRestaurants(list, { ...DEFAULT_FILTER, category: "catering" }))).toEqual(["fine"]);
    expect(ids(filterRestaurants(list, { ...DEFAULT_FILTER, category: "fine_dining" }))).toEqual(["fine"]);
    expect(ids(filterRestaurants(list, { ...DEFAULT_FILTER, category: "sushi" }))).toEqual(["sakura", "closed", "paused"]);
  });

  it("query matches name or category label, case-insensitive", () => {
    expect(ids(filterRestaurants(list, { ...DEFAULT_FILTER, query: "  NOBU " }))).toEqual(["closed"]);
    expect(ids(filterRestaurants(list, { ...DEFAULT_FILTER, query: "fine" }))).toEqual(["fine"]);
  });

  it("default filter returns everything in fetch order", () => {
    expect(ids(filterRestaurants(list, DEFAULT_FILTER))).toEqual(ids(list));
    expect(isDefaultFilter(DEFAULT_FILTER)).toBe(true);
    expect(isDefaultFilter({ ...DEFAULT_FILTER, sort: "rating" })).toBe(true); // sort alone keeps the rails
    expect(isDefaultFilter({ ...DEFAULT_FILTER, openNowOnly: true })).toBe(false);
  });
});

describe("sortRestaurants", () => {
  const list = [
    r("a", { distanceM: null, ratingAvg: 4.2, ratingCount: 10 }),
    r("b", { distanceM: 900, ratingAvg: 4.8, ratingCount: 2 }),
    r("c", { distanceM: 300, ratingAvg: 4.8, ratingCount: 40 }),
    r("d", { distanceM: null, ratingAvg: null, ratingCount: 0 }),
  ];

  it("Distanță: nearest first, unknown distance last", () => {
    expect(ids(sortRestaurants(list, "distance"))).toEqual(["c", "b", "a", "d"]);
  });

  it("Rating: best average first, ties broken by review count, unrated last", () => {
    expect(ids(sortRestaurants(list, "rating"))).toEqual(["c", "b", "a", "d"]);
  });

  it("Recomandate keeps the fetch order and never mutates the input", () => {
    expect(ids(sortRestaurants(list, "recommended"))).toEqual(["a", "b", "c", "d"]);
    sortRestaurants(list, "distance");
    expect(ids(list)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("popularRestaurants", () => {
  it("needs >= 3 reviews so a lone 5-star does not lead", () => {
    const list = [
      r("lone", { ratingAvg: 5, ratingCount: 1 }),
      r("good", { ratingAvg: 4.6, ratingCount: 12 }),
      r("best", { ratingAvg: 4.9, ratingCount: 3 }),
    ];
    expect(ids(popularRestaurants(list))).toEqual(["best", "good"]);
    expect(popularRestaurants(list, 1)).toHaveLength(1);
  });
});

describe("isStale (open-now refresh on focus)", () => {
  it("never loaded or a minute old -> refetch; fresher -> keep", () => {
    expect(isStale(null, 0)).toBe(true);
    expect(isStale(1_000, 1_000 + STALE_AFTER_MS - 1)).toBe(false);
    expect(isStale(1_000, 1_000 + STALE_AFTER_MS)).toBe(true);
  });
});

describe("loginErrorText (same Romanian lines as the web LoginForm)", () => {
  it("a short password is not reported as a taken email", () => {
    expect(loginErrorText("Password should be at least 6 characters.")).toBe("Parola trebuie să aibă minim 6 caractere.");
  });
  it.each([
    ["Invalid login credentials", "Email sau parolă greșite."],
    ["User already registered", "Există deja un cont cu acest email."],
    ["Unable to validate email address: invalid format", "Emailul nu pare valid."],
    ["Email not confirmed", "Confirmă emailul din mesajul primit, apoi autentifică-te."],
    ["email rate limit exceeded", "Prea multe încercări — încearcă din nou peste câteva minute."],
    ["TypeError: Network request failed", "Nu ne-am putut conecta. Verifică internetul și încearcă din nou."],
    ["something brand new", "A apărut o eroare. Încearcă din nou."],
  ])("%s", (raw, expected) => {
    expect(loginErrorText(raw)).toBe(expected);
  });
});
