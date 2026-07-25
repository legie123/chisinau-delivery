import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartLine {
  menuItemId: string;
  name: string;
  priceMdl: number;
  quantity: number;
}

// A different-restaurant add is held here instead of silently wiping the cart —
// the UI (MenuBrowser) renders an inline confirm and calls confirmSwitch/cancelSwitch.
interface PendingSwitch {
  restaurantId: string;
  restaurantName: string;
  item: { id: string; name: string; price_mdl: number };
}

interface CartState {
  restaurantId: string | null;
  restaurantName: string | null;
  lines: CartLine[];
  pendingSwitch: PendingSwitch | null;
  addItem: (restaurantId: string, restaurantName: string, item: { id: string; name: string; price_mdl: number }) => void;
  confirmSwitch: () => void;
  cancelSwitch: () => void;
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
      pendingSwitch: null,

      addItem: (restaurantId, restaurantName, item) => {
        const current = get();
        const switchingRestaurant = current.restaurantId !== null && current.restaurantId !== restaurantId;

        // Cross-restaurant orders aren't supported — but wiping without asking lost
        // orders silently (#38). Hold the add and let the UI confirm first.
        if (switchingRestaurant && current.lines.length > 0) {
          set({ pendingSwitch: { restaurantId, restaurantName, item } });
          return;
        }

        const lines = switchingRestaurant ? [] : current.lines;
        const existing = lines.find((l) => l.menuItemId === item.id);
        const nextLines = existing
          ? lines.map((l) => (l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l))
          : [...lines, { menuItemId: item.id, name: item.name, priceMdl: item.price_mdl, quantity: 1 }];

        set({ restaurantId, restaurantName, lines: nextLines, pendingSwitch: null });
      },

      confirmSwitch: () => {
        const { pendingSwitch } = get();
        if (!pendingSwitch) return;
        const { restaurantId, restaurantName, item } = pendingSwitch;
        set({
          restaurantId,
          restaurantName,
          lines: [{ menuItemId: item.id, name: item.name, priceMdl: item.price_mdl, quantity: 1 }],
          pendingSwitch: null,
        });
      },

      cancelSwitch: () => set({ pendingSwitch: null }),

      removeItem: (menuItemId) => set((state) => ({ lines: state.lines.filter((l) => l.menuItemId !== menuItemId) })),

      setQuantity: (menuItemId, quantity) =>
        set((state) => ({
          lines:
            quantity <= 0
              ? state.lines.filter((l) => l.menuItemId !== menuItemId)
              : state.lines.map((l) => (l.menuItemId === menuItemId ? { ...l, quantity } : l)),
        })),

      clear: () => set({ restaurantId: null, restaurantName: null, lines: [], pendingSwitch: null }),
    }),
    {
      name: "chisinau-delivery-cart",
      // pendingSwitch is transient UI state — don't persist a stale confirm banner.
      partialize: (state) => ({ restaurantId: state.restaurantId, restaurantName: state.restaurantName, lines: state.lines }),
    },
  ),
);

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.priceMdl * l.quantity, 0);
}
