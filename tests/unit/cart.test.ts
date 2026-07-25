import { beforeEach, describe, expect, it, vi } from "vitest";

// zustand/persist expects localStorage — stub it for node before importing the store.
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
});

const { useCartStore, cartSubtotal } = await import("@/lib/orders/cart");

const item = (id: string, price: number) => ({ id, name: `Item ${id}`, price_mdl: price });

describe("cart store — banii clientului", () => {
  beforeEach(() => {
    useCartStore.getState().clear();
  });

  it("adds items and increments quantity on repeat add", () => {
    const { addItem } = useCartStore.getState();
    addItem("r1", "Sakura", item("a", 180));
    addItem("r1", "Sakura", item("a", 180));
    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(2);
  });

  it("switching restaurants holds a pendingSwitch instead of silently wiping the cart (#38)", () => {
    const { addItem } = useCartStore.getState();
    addItem("r1", "Sakura", item("a", 180));
    addItem("r2", "Le Jardin", item("b", 340));
    const state = useCartStore.getState();
    // Cart is untouched until the switch is confirmed.
    expect(state.restaurantId).toBe("r1");
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0].menuItemId).toBe("a");
    expect(state.pendingSwitch).toEqual({ restaurantId: "r2", restaurantName: "Le Jardin", item: item("b", 340) });
  });

  it("confirmSwitch clears the old cart and adds the pending item from the new restaurant", () => {
    const { addItem, confirmSwitch } = useCartStore.getState();
    addItem("r1", "Sakura", item("a", 180));
    addItem("r2", "Le Jardin", item("b", 340));
    confirmSwitch();
    const state = useCartStore.getState();
    expect(state.restaurantId).toBe("r2");
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0].menuItemId).toBe("b");
    expect(state.pendingSwitch).toBeNull();
  });

  it("cancelSwitch discards the pending add and keeps the original cart", () => {
    const { addItem, cancelSwitch } = useCartStore.getState();
    addItem("r1", "Sakura", item("a", 180));
    addItem("r2", "Le Jardin", item("b", 340));
    cancelSwitch();
    const state = useCartStore.getState();
    expect(state.restaurantId).toBe("r1");
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0].menuItemId).toBe("a");
    expect(state.pendingSwitch).toBeNull();
  });

  it("setQuantity to 0 or below removes the line", () => {
    const { addItem, setQuantity } = useCartStore.getState();
    addItem("r1", "Sakura", item("a", 180));
    setQuantity("a", 0);
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it("subtotal math is exact", () => {
    const { addItem, setQuantity } = useCartStore.getState();
    addItem("r1", "Sakura", item("a", 180));
    setQuantity("a", 3);
    addItem("r1", "Sakura", item("b", 620));
    expect(cartSubtotal(useCartStore.getState().lines)).toBe(180 * 3 + 620);
  });

  it("removeItem drops only the targeted line", () => {
    const { addItem, removeItem } = useCartStore.getState();
    addItem("r1", "Sakura", item("a", 180));
    addItem("r1", "Sakura", item("b", 620));
    removeItem("a");
    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0].menuItemId).toBe("b");
  });
});
