import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LINE_NOTE_MAX } from "@chisinau/shared-domain";

export interface CartLine {
  lineId: string; // menuItemId, or menuItemId::sortedOptionIds when customized
  menuItemId: string;
  name: string;
  priceMdl: number; // UNIT price incl. option deltas
  quantity: number;
  optionIds: string[];
  optionsLabel: string; // human summary e.g. "Teriyaki, Wasabi extra"
  /** Set by live reconciliation when the item/option vanished from the menu —
   *  place_order would reject the whole cart with a generic error otherwise. */
  unavailable?: boolean;
  /** Kitchen note on this dish ("fără wasabi"), kept as typed, max 140; sent trimmed (placeOrderItems). */
  notes?: string;
}

// Options chosen in the modifier modal; omitted for a plain add.
export interface ChosenOptions {
  optionIds: string[];
  optionsLabel: string;
  unitPriceMdl: number; // base + deltas
}

interface PendingSwitch {
  restaurantId: string;
  restaurantName: string;
  item: { id: string; name: string; price_mdl: number };
  options?: ChosenOptions;
}

interface CartState {
  restaurantId: string | null;
  restaurantName: string | null;
  lines: CartLine[];
  pendingSwitch: PendingSwitch | null;
  addItem: (
    restaurantId: string,
    restaurantName: string,
    item: { id: string; name: string; price_mdl: number },
    options?: ChosenOptions,
  ) => void;
  confirmSwitch: () => void;
  cancelSwitch: () => void;
  removeItem: (lineId: string) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  /** Kitchen note per line; blank clears it. Same rule as the mobile cart (shared setLineNotes). */
  setNotes: (lineId: string, notes: string) => void;
  /** Live-menu reconciliation (prices moved / line went dead). */
  updateLine: (lineId: string, patch: Partial<Pick<CartLine, "priceMdl" | "unavailable">>) => void;
  clear: () => void;
}

// The canonical cart line id: the item id, or item id + sorted option ids when
// customized. Exported so callers that must address a line AFTER adding it (e.g.
// reorder setting quantity on an option-bearing line) compute the SAME id.
export function cartLineId(menuItemId: string, optionIds: string[] = []): string {
  return optionIds.length ? `${menuItemId}::${[...optionIds].sort().join(",")}` : menuItemId;
}

function makeLine(item: { id: string; name: string; price_mdl: number }, options?: ChosenOptions): CartLine {
  const optionIds = options?.optionIds ?? [];
  const lineId = cartLineId(item.id, optionIds);
  return {
    lineId,
    menuItemId: item.id,
    name: item.name,
    priceMdl: options?.unitPriceMdl ?? item.price_mdl,
    quantity: 1,
    optionIds,
    optionsLabel: options?.optionsLabel ?? "",
  };
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      restaurantId: null,
      restaurantName: null,
      lines: [],
      pendingSwitch: null,

      addItem: (restaurantId, restaurantName, item, options) => {
        const current = get();
        const switchingRestaurant = current.restaurantId !== null && current.restaurantId !== restaurantId;

        // Cross-restaurant orders aren't supported — hold the add and let the UI confirm (#38).
        if (switchingRestaurant && current.lines.length > 0) {
          set({ pendingSwitch: { restaurantId, restaurantName, item, options } });
          return;
        }

        const lines = switchingRestaurant ? [] : current.lines;
        const line = makeLine(item, options);
        const existing = lines.find((l) => l.lineId === line.lineId);
        const nextLines = existing
          ? lines.map((l) => (l.lineId === line.lineId ? { ...l, quantity: l.quantity + 1 } : l))
          : [...lines, line];

        set({ restaurantId, restaurantName, lines: nextLines, pendingSwitch: null });
      },

      confirmSwitch: () => {
        const { pendingSwitch } = get();
        if (!pendingSwitch) return;
        const { restaurantId, restaurantName, item, options } = pendingSwitch;
        set({
          restaurantId,
          restaurantName,
          lines: [makeLine(item, options)],
          pendingSwitch: null,
        });
      },

      cancelSwitch: () => set({ pendingSwitch: null }),

      updateLine: (lineId, patch) =>
        set((state) => ({
          lines: state.lines.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)),
        })),

      removeItem: (lineId) => set((state) => ({ lines: state.lines.filter((l) => l.lineId !== lineId) })),

      setQuantity: (lineId, quantity) =>
        set((state) => ({
          lines:
            quantity <= 0
              ? state.lines.filter((l) => l.lineId !== lineId)
              : state.lines.map((l) => (l.lineId === lineId ? { ...l, quantity } : l)),
        })),

      setNotes: (lineId, notes) =>
        set((state) => ({
          lines: state.lines.map((l) => {
            if (l.lineId !== lineId) return l;
            const raw = notes.slice(0, LINE_NOTE_MAX);
            const { notes: _old, ...rest } = l;
            void _old;
            return raw.trim() ? { ...rest, notes: raw } : rest;
          }),
        })),

      clear: () => set({ restaurantId: null, restaurantName: null, lines: [], pendingSwitch: null }),
    }),
    {
      name: "chisinau-delivery-cart",
      partialize: (state) => ({ restaurantId: state.restaurantId, restaurantName: state.restaurantName, lines: state.lines }),
    },
  ),
);

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.priceMdl * l.quantity, 0);
}
