import { addToCart, EMPTY_CART, type CartState } from "@chisinau/shared-domain";

// "Comandă din nou" — the web ReorderButton + orders/page.tsx buildReorderItems, pure.
// Each order_item's selected_options SNAPSHOT ({group, name}) is replayed onto the
// CURRENT menu_options ids. An item whose menu now has a required group the old
// choices don't cover is skipped (can't be one-tap reordered — add it from the menu);
// so is an item that is gone or unavailable (the web leaves those for the cart's
// reconciliation to flag; skipping names them up front). Prices are the snapshot:
// CartScreen reprices to live and says so.

export type ReorderSourceItem = {
  menu_item_id: string | null;
  item_name_snapshot: string;
  unit_price_mdl: number;
  quantity: number;
  selected_options: { group: string; name: string }[] | null;
};
export type ReorderGroup = {
  menu_item_id: string;
  name: string;
  is_required: boolean;
  min_select: number;
  menu_options: { id: string; name: string }[];
};
export type ReorderLiveItem = { id: string; is_available: boolean };

export type ReorderSkip = { name: string; reason: "unavailable" | "options" };
export type ReorderPlan = { cart: CartState; skipped: ReorderSkip[] };

export function planReorder(
  restaurant: { id: string; name: string },
  items: ReorderSourceItem[],
  groups: ReorderGroup[],
  live: ReorderLiveItem[],
): ReorderPlan {
  const optionId = new Map<string, string>(); // `${menuItemId}|${group}|${name}` -> option id
  const required = new Map<string, Set<string>>(); // menuItemId -> required group names
  for (const g of groups) {
    // place_order: required = is_required (≥ max(min,1)) or min_select ≥ 1.
    if (g.is_required || g.min_select >= 1) {
      required.set(g.menu_item_id, (required.get(g.menu_item_id) ?? new Set()).add(g.name));
    }
    for (const o of g.menu_options ?? []) optionId.set(`${g.menu_item_id}|${g.name}|${o.name}`, o.id);
  }
  const available = new Set(live.filter((l) => l.is_available).map((l) => l.id));

  let cart: CartState = EMPTY_CART;
  const skipped: ReorderSkip[] = [];
  for (const it of items) {
    if (!it.menu_item_id || !available.has(it.menu_item_id)) {
      skipped.push({ name: it.item_name_snapshot, reason: "unavailable" });
      continue;
    }
    const menuItemId = it.menu_item_id;
    const chosen = it.selected_options ?? [];
    const ids: string[] = [];
    const covered = new Set<string>();
    for (const sel of chosen) {
      const id = optionId.get(`${menuItemId}|${sel.group}|${sel.name}`);
      if (id) {
        ids.push(id);
        covered.add(sel.group);
      }
    }
    if ([...(required.get(menuItemId) ?? [])].some((g) => !covered.has(g))) {
      skipped.push({ name: it.item_name_snapshot, reason: "options" });
      continue;
    }
    const unit = Number(it.unit_price_mdl);
    const ref = { id: menuItemId, name: it.item_name_snapshot, price_mdl: unit };
    const options = ids.length ? { optionIds: ids, optionsLabel: chosen.map((s) => s.name).join(", "), unitPriceMdl: unit } : undefined;
    cart = addToCart(cart, restaurant, ref, options, it.quantity);
  }
  return { cart, skipped };
}

/** The notice for what could not be re-added; null when everything was. */
export function reorderSkipText(skipped: ReorderSkip[]): string | null {
  if (skipped.length === 0) return null;
  const gone = skipped.filter((s) => s.reason === "unavailable").map((s) => s.name);
  const changed = skipped.filter((s) => s.reason === "options").map((s) => s.name);
  const parts: string[] = [];
  if (gone.length) parts.push(`${gone.join(", ")} — ${gone.length === 1 ? "nu mai este disponibil" : "nu mai sunt disponibile"}`);
  if (changed.length) parts.push(`${changed.join(", ")} — ${changed.length === 1 ? "are opțiuni noi" : "au opțiuni noi"}, adaugă din meniu`);
  return parts.join(". ") + ".";
}
