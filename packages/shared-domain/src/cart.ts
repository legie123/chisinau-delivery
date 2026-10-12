// Pure cart model — the same rules as the web store (src/lib/orders/cart.ts), minus
// the storage: one restaurant per cart, a line per (item, sorted option ids), unit
// price includes option deltas. place_order re-prices everything server-side; this
// only has to agree with it so the customer sees the total they will pay.
// Also the modifier-selection rules of the web ItemModifierModal (required group =
// at least max(min_select,1); never above max_select; single-pick groups replace).

export interface CartLine {
  lineId: string; // menuItemId, or menuItemId::sortedOptionIds when customized
  menuItemId: string;
  name: string;
  priceMdl: number; // UNIT price incl. option deltas
  quantity: number;
  optionIds: string[];
  optionsLabel: string;
  /** A note for the kitchen on this dish ("fără wasabi"); max 140, sent as p_items[].notes. */
  notes?: string;
}

export interface CartState {
  restaurantId: string | null;
  restaurantName: string | null;
  lines: CartLine[];
}

export interface ChosenOptions {
  optionIds: string[];
  optionsLabel: string;
  unitPriceMdl: number; // base + deltas
}

export type CartItemRef = { id: string; name: string; price_mdl: number };

export const EMPTY_CART: CartState = { restaurantId: null, restaurantName: null, lines: [] };

export function cartLineId(menuItemId: string, optionIds: string[] = []): string {
  return optionIds.length ? `${menuItemId}::${[...optionIds].sort().join(",")}` : menuItemId;
}

/** True when adding from `restaurantId` would discard a non-empty cart from another one. */
export function needsRestaurantSwitch(state: CartState, restaurantId: string): boolean {
  return state.restaurantId !== null && state.restaurantId !== restaurantId && state.lines.length > 0;
}

/** Adds `quantity` of an item (merging into an identical line). Switching restaurant
 *  starts a fresh cart — callers confirm that first via needsRestaurantSwitch. */
export function addToCart(
  state: CartState,
  restaurant: { id: string; name: string },
  item: CartItemRef,
  options?: ChosenOptions,
  quantity = 1,
): CartState {
  const qty = Math.max(1, Math.floor(quantity));
  const lines = state.restaurantId === restaurant.id ? state.lines : [];
  const optionIds = options?.optionIds ?? [];
  const lineId = cartLineId(item.id, optionIds);
  const existing = lines.find((l) => l.lineId === lineId);
  const nextLines = existing
    ? lines.map((l) => (l.lineId === lineId ? { ...l, quantity: l.quantity + qty } : l))
    : [
        ...lines,
        {
          lineId,
          menuItemId: item.id,
          name: item.name,
          priceMdl: options?.unitPriceMdl ?? Number(item.price_mdl),
          quantity: qty,
          optionIds,
          optionsLabel: options?.optionsLabel ?? "",
        },
      ];
  return { restaurantId: restaurant.id, restaurantName: restaurant.name, lines: nextLines };
}

/** quantity <= 0 removes the line. */
export function setLineQuantity(state: CartState, lineId: string, quantity: number): CartState {
  const lines =
    quantity <= 0
      ? state.lines.filter((l) => l.lineId !== lineId)
      : state.lines.map((l) => (l.lineId === lineId ? { ...l, quantity: Math.floor(quantity) } : l));
  return { ...state, lines };
}

export const LINE_NOTE_MAX = 140;

/** Sets (or, when blank, clears) the kitchen note of one line. Kept as typed (a trim on every
 *  keystroke would eat the space between words); placeOrderItems sends it trimmed. Max 140, like
 *  place_order. */
export function setLineNotes(state: CartState, lineId: string, notes: string): CartState {
  const raw = notes.slice(0, LINE_NOTE_MAX);
  return {
    ...state,
    lines: state.lines.map((l) => {
      if (l.lineId !== lineId) return l;
      const { notes: _old, ...rest } = l;
      void _old;
      return raw.trim() ? { ...rest, notes: raw } : rest;
    }),
  };
}

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.priceMdl * l.quantity, 0);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** The p_items payload of place_order — the server recomputes every price from these. */
export function placeOrderItems(
  lines: CartLine[],
): Array<{ menu_item_id: string; quantity: number; option_ids: string[]; notes?: string }> {
  return lines.map((l) => ({
    menu_item_id: l.menuItemId,
    quantity: l.quantity,
    option_ids: l.optionIds,
    ...(l.notes?.trim() ? { notes: l.notes.trim() } : {}),
  }));
}

// ---- Modifiers ----

export interface OptionGroupLike {
  id: string;
  name: string;
  is_required: boolean;
  min_select: number;
  max_select: number;
  options: Array<{ id: string; name: string; price_delta_mdl: number; is_available: boolean }>;
}

export type Selection = Record<string, string[]>; // groupId -> chosen option ids

export function toggleOption(selection: Selection, group: OptionGroupLike, optionId: string): Selection {
  const option = group.options.find((o) => o.id === optionId);
  if (!option || !option.is_available) return selection;
  const cur = selection[group.id] ?? [];
  if (group.max_select === 1) return { ...selection, [group.id]: [optionId] };
  if (cur.includes(optionId)) return { ...selection, [group.id]: cur.filter((x) => x !== optionId) };
  if (cur.length >= group.max_select) return selection;
  return { ...selection, [group.id]: [...cur, optionId] };
}

export function selectionIsValid(groups: OptionGroupLike[], selection: Selection): boolean {
  return groups.every((g) => {
    const n = (selection[g.id] ?? []).length;
    if (g.is_required && n < Math.max(g.min_select, 1)) return false;
    return n >= g.min_select && n <= g.max_select;
  });
}

export function chosenOptions(item: CartItemRef, groups: OptionGroupLike[], selection: Selection): ChosenOptions {
  const picked = groups.flatMap((g) =>
    (selection[g.id] ?? []).map((id) => g.options.find((o) => o.id === id)).filter((o) => o != null),
  );
  return {
    optionIds: picked.map((o) => o.id),
    optionsLabel: picked.map((o) => o.name).join(", "),
    unitPriceMdl: Number(item.price_mdl) + picked.reduce((s, o) => s + Number(o.price_delta_mdl), 0),
  };
}
