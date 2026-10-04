import type { CartLine } from "@chisinau/shared-domain";

// Native twin of the web useCartReconcile (src/hooks/useCartReconcile.ts). The cart
// persists across restarts but place_order re-prices from the live menu, so the
// screen re-reads the live rows and: refreshes each line's unit price (item price +
// option deltas, the same sum place_order makes) and flags lines whose item or any
// chosen option is gone/unavailable. Pure — CartScreen does the reads.

export type LiveItem = { id: string; price_mdl: number; is_available: boolean };
export type LiveOption = { id: string; price_delta_mdl: number; is_available: boolean };

export interface ReconcileResult {
  lines: CartLine[];
  repriced: { lineId: string; name: string; from: number; to: number }[];
  dead: { lineId: string; name: string }[];
}

export function reconcileLines(lines: CartLine[], items: LiveItem[], options: LiveOption[]): ReconcileResult {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const optionById = new Map(options.map((o) => [o.id, o]));
  const repriced: ReconcileResult["repriced"] = [];
  const dead: ReconcileResult["dead"] = [];

  const next = lines.map((line) => {
    const item = itemById.get(line.menuItemId);
    const lineOptions = line.optionIds.map((id) => optionById.get(id));
    if (!item || !item.is_available || lineOptions.some((o) => !o || !o.is_available)) {
      dead.push({ lineId: line.lineId, name: line.name });
      return line;
    }
    const cents = Math.round(Number(item.price_mdl) * 100) + lineOptions.reduce((s, o) => s + Math.round(Number(o!.price_delta_mdl) * 100), 0);
    const live = cents / 100;
    if (live === line.priceMdl) return line;
    repriced.push({ lineId: line.lineId, name: line.name, from: line.priceMdl, to: live });
    return { ...line, priceMdl: live };
  });
  return { lines: next, repriced, dead };
}
