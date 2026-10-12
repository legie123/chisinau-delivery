// Gate 2 (price integrity): the total the checkout shows is computed in ONE function, and the
// place_order payload carries that same number as p_expected_total, so the server refuses
// (sim 100) instead of charging a different amount. Tip is excluded from the expected total:
// set_order_tip adds it afterwards and the shown total includes it.
import { describe, expect, it } from "vitest";
import { EMPTY_CART, addToCart, cartSubtotal, chosenOptions, type OptionGroupLike } from "@chisinau/shared-domain";
import { buildOrderInput, checkoutTotals, tipFor } from "../src/lib/checkout";

const r = { id: "r1", name: "Sakura" };
const roll = { id: "m1", name: "Philadelphia", price_mdl: 179.9 };
const sauce: OptionGroupLike = {
  id: "g1", name: "Sos", is_required: true, min_select: 1, max_select: 1,
  options: [{ id: "o-spicy", name: "Spicy", price_delta_mdl: 15.05, is_available: true }],
};

describe("checkoutTotals", () => {
  it("total = subtotal + delivery fee + tip; expected (sent to place_order) = subtotal + fee", () => {
    const opts = chosenOptions(roll, [sauce], { g1: ["o-spicy"] });
    const cart = addToCart(EMPTY_CART, r, roll, opts, 3);
    const tip = tipFor(cartSubtotal(cart.lines), "p10", "");
    const t = checkoutTotals(cart.lines, 25, tip);
    expect(t.subtotal).toBeCloseTo(584.85, 2);
    expect(t.tip).toBe(58);
    expect(t.total).toBeCloseTo(584.85 + 25 + 58, 2);
    expect(t.expectedTotal).toBeCloseTo(609.85, 2);
  });

  it("rounds to bani like numeric(10,2) on the server, never float drift", () => {
    const cart = addToCart(EMPTY_CART, r, { id: "m2", name: "Ceai", price_mdl: 0.1 }, undefined, 3);
    expect(checkoutTotals(cart.lines, 0.2, 0).expectedTotal).toBe(0.5);
  });
});

describe("buildOrderInput carries the shown total", () => {
  it("p_expected_total = the shown subtotal + the shown delivery fee", () => {
    const cart = addToCart(EMPTY_CART, r, roll, undefined, 2);
    const input = buildOrderInput(cart, { deliveryAddressId: "a", paymentMethod: "cash", idempotencyKey: "k", deliveryFeeMdl: 30 });
    expect(input.expectedTotalMdl).toBe(checkoutTotals(cart.lines, 30, 0).expectedTotal);
    expect(input.expectedTotalMdl).toBe(389.8);
  });
});
