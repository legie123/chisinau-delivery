// Bulk price change for the menu. Prices already ordered are safe: order_items keeps
// unit_price_mdl per line. New price is rounded to whole MDL and must stay > 0; a change
// beyond ±50 % is refused as a likely typo (ponytail: fixed cap — make it a setting if needed).
export type PriceItem = { id: string; name: string; price_mdl: number };
export type BulkMode = "percent" | "amount";
export type PriceChange = { id: string; name: string; from: number; to: number };

export function bulkPrices(items: PriceItem[], mode: BulkMode, value: number): { changes: PriceChange[]; error: string | null } {
  if (!Number.isFinite(value) || value === 0) return { changes: [], error: "Alege o modificare diferită de 0." };
  if (mode === "percent" && Math.abs(value) > 50) return { changes: [], error: "Cel mult ±50 % o dată." };
  const changes: PriceChange[] = [];
  for (const it of items) {
    const from = Number(it.price_mdl);
    const to = Math.round(mode === "percent" ? from * (1 + value / 100) : from + value);
    if (to <= 0) return { changes: [], error: `„${it.name}” ar ajunge la ${to} MDL — prețul trebuie să rămână peste 0.` };
    if (Math.abs(to - from) / from > 0.5) return { changes: [], error: `„${it.name}” s-ar schimba cu peste 50 % (${from} → ${to} MDL).` };
    if (to !== from) changes.push({ id: it.id, name: it.name, from, to });
  }
  return { changes, error: null };
}

/** Strict number parse: "10", "-5", "7,5" — not "0x10" or "1e2" (Number() accepts those). */
export function parseChange(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}
