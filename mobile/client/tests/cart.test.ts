import { describe, expect, it } from "vitest";
import {
  EMPTY_CART,
  addToCart,
  cartCount,
  cartLineId,
  cartSubtotal,
  chosenOptions,
  needsRestaurantSwitch,
  placeOrderItems,
  selectionIsValid,
  setLineQuantity,
  toggleOption,
  type OptionGroupLike,
} from "@chisinau/shared-domain";
import { buildOrderInput, newIdempotencyKey, tipAmount } from "../src/lib/checkout";

const sakura = { id: "r1", name: "Sakura" };
const roll = { id: "m1", name: "Philadelphia", price_mdl: 180 };
const sauce: OptionGroupLike = {
  id: "g1", name: "Sos", is_required: true, min_select: 1, max_select: 1,
  options: [
    { id: "o-teriyaki", name: "Teriyaki", price_delta_mdl: 0, is_available: true },
    { id: "o-spicy", name: "Spicy", price_delta_mdl: 15, is_available: true },
    { id: "o-gone", name: "Epuizat", price_delta_mdl: 5, is_available: false },
  ],
};
const extras: OptionGroupLike = {
  id: "g2", name: "Extra", is_required: false, min_select: 0, max_select: 2,
  options: [
    { id: "o-wasabi", name: "Wasabi", price_delta_mdl: 10, is_available: true },
    { id: "o-ginger", name: "Ghimbir", price_delta_mdl: 7.5, is_available: true },
    { id: "o-sesame", name: "Susan", price_delta_mdl: 5, is_available: true },
  ],
};

describe("cart lines — same ids as the web cart", () => {
  it("line id = item id, or item id + SORTED option ids", () => {
    expect(cartLineId("m1")).toBe("m1");
    expect(cartLineId("m1", ["b", "a"])).toBe("m1::a,b");
    expect(cartLineId("m1", ["a", "b"])).toBe(cartLineId("m1", ["b", "a"]));
  });

  it("re-adding the same item+options merges; different options make a new line", () => {
    const opts = chosenOptions(roll, [sauce], { g1: ["o-spicy"] });
    let s = addToCart(EMPTY_CART, sakura, roll);
    s = addToCart(s, sakura, roll);
    s = addToCart(s, sakura, roll, opts);
    s = addToCart(s, sakura, roll, opts, 2);
    expect(s.lines).toHaveLength(2);
    expect(s.lines.find((l) => l.lineId === "m1")?.quantity).toBe(2);
    expect(s.lines.find((l) => l.lineId === "m1::o-spicy")?.quantity).toBe(3);
  });

  it("subtotal uses the unit price INCLUDING option deltas", () => {
    const opts = chosenOptions(roll, [sauce, extras], { g1: ["o-spicy"], g2: ["o-wasabi", "o-ginger"] });
    expect(opts.unitPriceMdl).toBe(180 + 15 + 10 + 7.5);
    expect(opts.optionsLabel).toBe("Spicy, Wasabi, Ghimbir");
    const s = addToCart(addToCart(EMPTY_CART, sakura, roll, opts, 2), sakura, { id: "m2", name: "Miso", price_mdl: 45 });
    expect(cartSubtotal(s.lines)).toBe(2 * 212.5 + 45);
    expect(cartCount(s.lines)).toBe(3);
  });

  it("another restaurant needs confirmation; adding there starts a fresh cart", () => {
    const s = addToCart(EMPTY_CART, sakura, roll);
    expect(needsRestaurantSwitch(s, "r1")).toBe(false);
    expect(needsRestaurantSwitch(s, "r2")).toBe(true);
    expect(needsRestaurantSwitch(EMPTY_CART, "r2")).toBe(false);
    const fresh = addToCart(s, { id: "r2", name: "Nobu" }, { id: "x", name: "X", price_mdl: 10 });
    expect(fresh.restaurantId).toBe("r2");
    expect(fresh.lines.map((l) => l.menuItemId)).toEqual(["x"]);
  });

  it("quantity 0 removes the line, otherwise sets it", () => {
    const s = addToCart(EMPTY_CART, sakura, roll, undefined, 3);
    expect(setLineQuantity(s, "m1", 1).lines[0].quantity).toBe(1);
    expect(setLineQuantity(s, "m1", 0).lines).toHaveLength(0);
  });
});

describe("modifier rules — mirror of ItemModifierModal", () => {
  it("required single-pick group: none chosen = invalid, one = valid, a second pick REPLACES", () => {
    expect(selectionIsValid([sauce], {})).toBe(false);
    let sel = toggleOption({}, sauce, "o-teriyaki");
    expect(selectionIsValid([sauce], sel)).toBe(true);
    sel = toggleOption(sel, sauce, "o-spicy");
    expect(sel.g1).toEqual(["o-spicy"]);
  });

  it("multi-pick caps at max_select and toggles off; unavailable options can't be picked", () => {
    let sel = toggleOption({}, extras, "o-wasabi");
    sel = toggleOption(sel, extras, "o-ginger");
    sel = toggleOption(sel, extras, "o-sesame"); // over max 2 -> ignored
    expect(sel.g2).toEqual(["o-wasabi", "o-ginger"]);
    sel = toggleOption(sel, extras, "o-wasabi");
    expect(sel.g2).toEqual(["o-ginger"]);
    expect(toggleOption({}, sauce, "o-gone")).toEqual({});
    expect(selectionIsValid([extras], {})).toBe(true); // optional group may stay empty
  });
});

describe("place_order payload — what the phone sends", () => {
  it("items carry menu_item_id, quantity and option_ids (server re-prices from these)", () => {
    const opts = chosenOptions(roll, [sauce], { g1: ["o-spicy"] });
    const cart = addToCart(addToCart(EMPTY_CART, sakura, roll, opts, 2), sakura, { id: "m2", name: "Miso", price_mdl: 45 });
    expect(placeOrderItems(cart.lines)).toEqual([
      { menu_item_id: "m1", quantity: 2, option_ids: ["o-spicy"] },
      { menu_item_id: "m2", quantity: 1, option_ids: [] },
    ]);
    const input = buildOrderInput(cart, { deliveryAddressId: "addr-1", paymentMethod: "cash", idempotencyKey: "k-1", notes: "  " });
    expect(input).toEqual({
      restaurantId: "r1",
      orderType: "standard",
      paymentMethod: "cash",
      items: placeOrderItems(cart.lines),
      deliveryAddressId: "addr-1",
      notes: undefined,
      idempotencyKey: "k-1",
    });
  });

  it("an empty cart never reaches place_order", () => {
    expect(() => buildOrderInput(EMPTY_CART, { deliveryAddressId: "a", paymentMethod: "cash", idempotencyKey: "k" })).toThrow();
  });

  it("idempotency keys differ per attempt; tips round like the web checkout", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(200);
    expect(tipAmount(333, "p15")).toBe(50);
    expect(tipAmount(333, "none")).toBe(0);
  });
});
