import { beforeEach, describe, expect, it, vi } from "vitest";
import { placeOrderItems } from "@chisinau/shared-domain";

// C2 on the web: the web cart store keeps a kitchen note per line like the mobile cart (kept as typed,
// max 140, blank clears it), and the checkout payload goes through the SAME placeOrderItems as mobile.
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
});
const { useCartStore } = await import("@/lib/orders/cart");

describe("web cart line notes", () => {
  beforeEach(() => useCartStore.getState().clear());

  it("setNotes keeps the note as typed on that line; blank clears; max 140", () => {
    const s = useCartStore.getState();
    s.addItem("r1", "Sakura", { id: "a", name: "Roll", price_mdl: 100 });
    s.addItem("r1", "Sakura", { id: "b", name: "Miso", price_mdl: 40 });
    useCartStore.getState().setNotes("a", "fără ");
    useCartStore.getState().setNotes("a", "fără wasabi ");
    expect(useCartStore.getState().lines.find((l) => l.lineId === "a")?.notes).toBe("fără wasabi ");
    expect(useCartStore.getState().lines.find((l) => l.lineId === "b")?.notes).toBeUndefined();
    useCartStore.getState().setNotes("a", "x".repeat(300));
    expect(useCartStore.getState().lines[0].notes).toHaveLength(140);
    useCartStore.getState().setNotes("a", "   ");
    expect(useCartStore.getState().lines[0].notes).toBeUndefined();
  });

  it("the checkout payload carries the trimmed note", () => {
    const s = useCartStore.getState();
    s.addItem("r1", "Sakura", { id: "a", name: "Roll", price_mdl: 100 });
    useCartStore.getState().setNotes("a", "  fără wasabi ");
    expect(placeOrderItems(useCartStore.getState().lines)).toEqual([
      { menu_item_id: "a", quantity: 1, option_ids: [], notes: "fără wasabi" },
    ]);
  });
});
