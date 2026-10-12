import { describe, expect, it } from "vitest";
import { EMPTY_CART, addToCart, placeOrderItems, setLineNotes } from "@chisinau/shared-domain";

// C2: a note per dish travels from the cart to place_order (which stores it on order_items.notes and
// the kitchen ticket prints it, sim 108). Blank notes are not sent; the payload stays as before.
describe("cart line notes", () => {
  const r = { id: "r1", name: "Sakura" };
  const roll = { id: "m1", name: "Philadelphia", price_mdl: 180 };

  it("setLineNotes keeps the note as typed (spaces between words survive), max 140, that line only", () => {
    let cart = addToCart(addToCart(EMPTY_CART, r, roll), r, { id: "m2", name: "Miso", price_mdl: 45 });
    cart = setLineNotes(cart, "m1", "fără ");          // mid-typing: the trailing space must stay
    cart = setLineNotes(cart, "m1", "fără wasabi  ");
    expect(cart.lines.find((l) => l.lineId === "m1")?.notes).toBe("fără wasabi  ");
    expect(placeOrderItems(cart.lines)[0].notes).toBe("fără wasabi");
    expect(cart.lines.find((l) => l.lineId === "m2")?.notes).toBeUndefined();
    expect(setLineNotes(cart, "m1", "x".repeat(200)).lines[0].notes).toHaveLength(140);
  });

  it("placeOrderItems sends notes only when there is one", () => {
    const cart = setLineNotes(addToCart(addToCart(EMPTY_CART, r, roll), r, { id: "m2", name: "Miso", price_mdl: 45 }), "m1", "fără wasabi");
    expect(placeOrderItems(cart.lines)).toEqual([
      { menu_item_id: "m1", quantity: 1, option_ids: [], notes: "fără wasabi" },
      { menu_item_id: "m2", quantity: 1, option_ids: [] },
    ]);
  });

  it("clearing the note removes it", () => {
    const cart = setLineNotes(setLineNotes(addToCart(EMPTY_CART, r, roll), "m1", "ceva"), "m1", "   ");
    expect(cart.lines[0].notes).toBeUndefined();
  });
});
