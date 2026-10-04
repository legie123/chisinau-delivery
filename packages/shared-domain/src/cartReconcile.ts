import type { CartLine } from "./cart";

// One reconciliation for the web cart (src/hooks/useCartReconcile.ts) and the client app
// (CartScreen). The cart persists across sessions but place_order re-prices from the live
// menu, so the caller re-reads the live rows and this: refreshes each line's unit price
// (item price + option deltas, the same sum place_order makes) and flags lines whose item or
// any chosen option is gone/unavailable. Pure — the callers do the reads. It used to exist
// twice; the twins drifted (float vs bani compare) and the web showed a "price changed"
// notice on every reorder with decimal option prices.

export type LiveItem = { id: string; price_mdl: number; is_available: boolean };
export type LiveOption = { id: string; price_delta_mdl: number; is_available: boolean };

type ReconcilableLine = Pick<CartLine, "lineId" | "menuItemId" | "name" | "priceMdl" | "optionIds">;

export interface ReconcileResult<L extends ReconcilableLine = CartLine> {
  lines: L[];
  repriced: { lineId: string; name: string; from: number; to: number }[];
  dead: { lineId: string; name: string }[];
}

export function reconcileLines<L extends ReconcilableLine>(lines: L[], items: LiveItem[], options: LiveOption[]): ReconcileResult<L> {
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
    // Compare in bani: the cart's unit price is a float sum (19.9 + 0.7 = 20.599999999999998).
    const was = Math.round(line.priceMdl * 100);
    if (cents === was) return line;
    repriced.push({ lineId: line.lineId, name: line.name, from: was / 100, to: live });
    return { ...line, priceMdl: live };
  });
  return { lines: next, repriced, dead };
}
