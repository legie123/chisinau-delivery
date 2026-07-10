import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartLine {
  menuItemId: string;
  name: string;
  priceMdl: number;
  quantity: number;
}

interface CartState {
  restaurantId: string | null;
  restaurantName: string | null;
  lines: CartLine[];
  addItem: (restaurantId: string, restaurantName: string, item: { id: string; name: string; price_mdl: number }) => void;
  removeItem: (menuItemId: string) => void;
  setQuantity: (menuItemId: string, quantity: number) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      restaurantId: null,
      restaurantName: null,
      lines: [],

      addItem: (restaurantId, restaurantName, item) => {
        const current = get();
        // Switching restaurants clears the cart — cross-restaurant orders aren't supported.
        const lines = current.restaurantId && current.restaurantId !== restaurantId ? [] : current.lines;

        const existing = lines.find((l) => l.menuItemId === item.id);
        const nextLines = existing
          ? lines.map((l) => (l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l))
          : [...lines, { menuItemId: item.id, name: item.name, priceMdl: item.price_mdl, quantity: 1 }];

        set({ restaurantId, restaurantName, lines: nextLines });
      },

      removeItem: (menuItemId) => set((state) => ({ lines: state.lines.filter((l) => l.menuItemId !== menuItemId) })),

      setQuantity: (menuItemId, quantity) =>
        set((state) => ({
          lines:
            quantity <= 0
              ? state.lines.filter((l) => l.menuItemId !== menuItemId)
              : state.lines.map((l) => (l.menuItemId === menuItemId ? { ...l, quantity } : l)),
        })),

      clear: () => set({ restaurantId: null, restaurantName: null, lines: [] }),
    }),
    { name: "chisinau-delivery-cart" },
  ),
);

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.priceMdl * l.quantity, 0);
}
