// Checkout / orders parity with the web customer app: scheduled window, cash-cap hint,
// custom tip + remembered prefs, address fields, reorder mapping. Pure logic only.
import { describe, expect, it } from "vitest";
import { EMPTY_CART, addToCart, type HoursRow } from "@chisinau/shared-domain";
import {
  addressDraftProblem,
  addressFingerprint,
  addressRow,
  buildOrderInput,
  cashCapExceeded,
  chisinauClock,
  chisinauWallTime,
  parsePrefs,
  reusableAddressId,
  scheduleProblem,
  tipFor,
} from "../src/lib/checkout";
import { planReorder, reorderSkipText, type ReorderGroup, type ReorderSourceItem } from "../src/lib/reorder";

const hours = (rows: [number, string, string][]): HoursRow[] =>
  rows.map(([day_of_week, opens_at, closes_at]) => ({ restaurant_id: "r1", day_of_week, opens_at, closes_at, is_closed: false }));

describe("scheduled delivery — Chișinău wall time → requested_for", () => {
  it("reads picker values as Chișinău time in summer (EEST, +3) and winter (EET, +2)", () => {
    expect(chisinauWallTime("2026-07-15", "12:30")!.toISOString()).toBe("2026-07-15T09:30:00.000Z");
    expect(chisinauWallTime("2026-12-15", "12:30")!.toISOString()).toBe("2026-12-15T10:30:00.000Z");
    expect(chisinauClock(new Date("2026-07-15T09:30:00Z"))).toEqual({ dow: 3, time: "12:30:00" });
  });

  it("rejects malformed picker values", () => {
    expect(chisinauWallTime("", "12:00")).toBeNull();
    expect(chisinauWallTime("2026-07-15", "")).toBeNull();
  });

  it("same window as web + place_order: future only, and the restaurant open then", () => {
    const now = new Date("2026-07-15T09:00:00Z").getTime(); // Wed 12:00 in Chișinău
    const wed = hours([[3, "10:00:00", "22:00:00"]]);
    expect(scheduleProblem(null, wed, now)).toMatch(/Alege data/);
    expect(scheduleProblem(chisinauWallTime("2026-07-15", "11:30"), wed, now)).toMatch(/în viitor/);
    expect(scheduleProblem(new Date(now), wed, now)).toMatch(/în viitor/);
    expect(scheduleProblem(chisinauWallTime("2026-07-15", "13:00"), wed, now)).toBeNull();
    expect(scheduleProblem(chisinauWallTime("2026-07-15", "22:30"), wed, now)).toMatch(/închis la ora aleasă/);
    expect(scheduleProblem(chisinauWallTime("2026-07-16", "13:00"), wed, now)).toMatch(/închis/); // no Thursday row
    // hours unknown: only the time check; place_order still checks the hours
    expect(scheduleProblem(chisinauWallTime("2026-07-16", "13:00"), null, now)).toBeNull();
  });

  it("an overnight span stored under the day it starts covers the early hours (restaurant_open_at)", () => {
    const now = new Date("2026-07-15T09:00:00Z").getTime();
    const late = hours([[3, "18:00:00", "02:00:00"]]);
    expect(scheduleProblem(chisinauWallTime("2026-07-16", "01:30"), late, now)).toBeNull();
    expect(scheduleProblem(chisinauWallTime("2026-07-16", "03:00"), late, now)).toMatch(/închis/);
  });

  it("buildOrderInput carries requestedFor to place_order (p_requested_for)", () => {
    const cart = addToCart(EMPTY_CART, { id: "r1", name: "R" }, { id: "m1", name: "Roll", price_mdl: 100 });
    const iso = "2026-07-15T10:00:00.000Z";
    expect(buildOrderInput(cart, { deliveryAddressId: "a", paymentMethod: "cash", idempotencyKey: "k", deliveryFeeMdl: 0, requestedFor: iso }).requestedFor).toBe(iso);
    expect(buildOrderInput(cart, { deliveryAddressId: "a", paymentMethod: "cash", idempotencyKey: "k", deliveryFeeMdl: 0 }).requestedFor).toBeUndefined();
  });
});

describe("cash cap hint — the sum place_order checks (subtotal + delivery fee, tip excluded)", () => {
  it("fires only above 1400 MDL and only for cash", () => {
    expect(cashCapExceeded("cash", 1350, 50)).toBe(false); // exactly 1400 passes the server
    expect(cashCapExceeded("cash", 1351, 50)).toBe(true);
    expect(cashCapExceeded("card_on_delivery", 5000, 50)).toBe(false);
  });
});

describe("tip — custom amount wins over the preset (web CheckoutForm)", () => {
  it("custom > 0 overrides the percentage; empty/zero/garbage falls back to it", () => {
    expect(tipFor(333, "p15", "")).toBe(50);
    expect(tipFor(333, "p15", "25")).toBe(25);
    expect(tipFor(333, "p15", "0")).toBe(50);
    expect(tipFor(333, "none", "abc")).toBe(0);
  });

  it("remembered prefs: only values the checkout can still offer survive", () => {
    expect(parsePrefs(JSON.stringify({ payment: "card_on_delivery", tip: "p10", customTip: "30" }))).toEqual({ payment: "card_on_delivery", tip: "p10", customTip: "30" });
    expect(parsePrefs(JSON.stringify({ payment: "online_gateway", tip: "toString", customTip: "-5" }))).toEqual({});
    expect(parsePrefs("not json")).toEqual({});
    expect(parsePrefs(null)).toEqual({});
  });
});

describe("address fields — web parity (sector, bloc, apartament, label)", () => {
  const draft = { street: " Str. A 1 ", phone: "069111111", notes: "", pin: null, sector: "Centru", building: "", apartment: "12", label: "Acasă" };

  it("row: trimmed, empty optional fields NULL, lat/lng only with a pin", () => {
    expect(addressRow(draft)).toEqual({
      street_address: "Str. A 1", contact_phone: "069111111", notes: null, label: "Acasă", sector: "Centru", building: null, apartment: "12",
    });
    expect(addressRow({ ...draft, pin: { lat: 47, lng: 28.8 } })).toMatchObject({ lat: 47, lng: 28.8 });
  });

  it("a failed attempt's row is reused only while every field is unchanged", () => {
    const cache = { id: "addr-1", fingerprint: addressFingerprint(draft) };
    expect(reusableAddressId(cache, { ...draft })).toBe("addr-1");
    expect(reusableAddressId(cache, { ...draft, apartment: "13" })).toBeNull();
    expect(reusableAddressId(cache, { ...draft, sector: "Botanica" })).toBeNull();
    expect(reusableAddressId(cache, { ...draft, label: "Birou" })).toBeNull();
  });

  it("street and a callable phone are required", () => {
    expect(addressDraftProblem({ ...draft, street: " " })).toMatch(/obligatorie/);
    expect(addressDraftProblem({ ...draft, phone: "12" })).toMatch(/telefon/);
    expect(addressDraftProblem({ ...draft, pin: { lat: 47.02, lng: 28.83 } })).toBeNull();
  });
});

describe("reorder — web ReorderButton semantics", () => {
  const sakura = { id: "r1", name: "Sakura" };
  const groups: ReorderGroup[] = [
    { menu_item_id: "m1", name: "Sos", is_required: true, min_select: 1, menu_options: [{ id: "o-spicy", name: "Picant" }, { id: "o-soy", name: "Soia" }] },
    { menu_item_id: "m3", name: "Mărime", is_required: false, min_select: 1, menu_options: [{ id: "o-xl", name: "XL" }] },
  ];
  const item = (over: Partial<ReorderSourceItem>): ReorderSourceItem => ({
    menu_item_id: "m1", item_name_snapshot: "California", unit_price_mdl: 120, quantity: 2, selected_options: [{ group: "Sos", name: "Picant" }], ...over,
  });
  const live = [{ id: "m1", is_available: true }, { id: "m2", is_available: true }, { id: "m3", is_available: true }, { id: "m4", is_available: false }];

  it("replays the original options onto CURRENT option ids, with quantity and snapshot price", () => {
    const { cart, skipped } = planReorder(sakura, [item({}), item({ menu_item_id: "m2", item_name_snapshot: "Miso", unit_price_mdl: 45, quantity: 1, selected_options: [] })], groups, live);
    expect(skipped).toEqual([]);
    expect(cart.restaurantId).toBe("r1");
    expect(cart.lines).toEqual([
      { lineId: "m1::o-spicy", menuItemId: "m1", name: "California", priceMdl: 120, quantity: 2, optionIds: ["o-spicy"], optionsLabel: "Picant" },
      { lineId: "m2", menuItemId: "m2", name: "Miso", priceMdl: 45, quantity: 1, optionIds: [], optionsLabel: "" },
    ]);
  });

  it("skips an item whose required group the old choices no longer cover (renamed option, new group)", () => {
    const renamed = item({ selected_options: [{ group: "Sos", name: "Dulce" }] });
    const newGroup = item({ menu_item_id: "m3", item_name_snapshot: "Ramen", selected_options: [] });
    const { cart, skipped } = planReorder(sakura, [renamed, newGroup], groups, live);
    expect(cart.lines).toEqual([]);
    expect(skipped).toEqual([{ name: "California", reason: "options" }, { name: "Ramen", reason: "options" }]);
  });

  it("skips deleted (menu_item_id null) and unavailable items, and names them", () => {
    const { cart, skipped } = planReorder(
      sakura,
      [item({}), item({ menu_item_id: null, item_name_snapshot: "Vechi" }), item({ menu_item_id: "m4", item_name_snapshot: "Tempura", selected_options: [] })],
      groups,
      live,
    );
    expect(cart.lines.map((l) => l.menuItemId)).toEqual(["m1"]);
    expect(skipped.map((s) => s.reason)).toEqual(["unavailable", "unavailable"]);
    expect(reorderSkipText(skipped)).toBe("Vechi, Tempura — nu mai sunt disponibile.");
    expect(reorderSkipText([{ name: "Ramen", reason: "options" }])).toBe("Ramen — are opțiuni noi, adaugă din meniu.");
    expect(reorderSkipText([])).toBeNull();
  });
});
