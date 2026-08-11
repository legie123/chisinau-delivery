"use client";

// Audit 2026-08-11 HIGH ×2: the cart total was a stale localStorage snapshot
// (a partner price edit was charged silently — place_order recomputes live),
// and a dead line failed checkout with a generic "un articol nu mai este
// disponibil" that never said WHICH. This hook re-reads the live menu for the
// cart's lines on /cart and /checkout, refreshes cached unit prices in place,
// flags dead lines (item or any chosen option gone), and tells the caller
// what changed so the UI can say it out loud instead of charging silently.

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCartStore } from "@/lib/orders/cart";

export interface CartReconcileResult {
  /** Lines whose unit price moved; label = "Nume fel" for the notice. */
  repriced: { lineId: string; name: string; from: number; to: number }[];
  /** Lines that can no longer be ordered (item/option unavailable or deleted). */
  dead: { lineId: string; name: string }[];
  done: boolean;
}

export function useCartReconcile(): CartReconcileResult {
  const lines = useCartStore((s) => s.lines);
  const updateLine = useCartStore((s) => s.updateLine);
  const [result, setResult] = useState<CartReconcileResult>({ repriced: [], dead: [], done: false });
  // Reconcile once per mount (not per keystroke of quantity) — the audit bug is
  // staleness across sessions, not intra-page races.
  const ranFor = useRef<string>("");

  useEffect(() => {
    const signature = lines.map((l) => l.lineId).sort().join("|");
    if (!signature || ranFor.current === signature) return;
    ranFor.current = signature;

    const itemIds = [...new Set(lines.map((l) => l.menuItemId))];
    const optionIds = [...new Set(lines.flatMap((l) => l.optionIds))];
    const supabase = createClient();
    let stale = false;

    (async () => {
      const [{ data: items }, { data: options }] = await Promise.all([
        supabase.from("menu_items").select("id, price_mdl, is_available").in("id", itemIds),
        optionIds.length
          ? supabase.from("menu_options").select("id, price_delta_mdl, is_available").in("id", optionIds)
          : Promise.resolve({ data: [] as { id: string; price_delta_mdl: number; is_available: boolean }[] }),
      ]);
      if (stale || !items) return;

      const itemById = new Map(items.map((i) => [i.id, i]));
      const optionById = new Map((options ?? []).map((o) => [o.id, o]));
      const repriced: CartReconcileResult["repriced"] = [];
      const dead: CartReconcileResult["dead"] = [];

      for (const line of lines) {
        const item = itemById.get(line.menuItemId);
        const lineOptions = line.optionIds.map((id) => optionById.get(id));
        const isDead = !item || !item.is_available || lineOptions.some((o) => !o || !o.is_available);
        if (isDead) {
          dead.push({ lineId: line.lineId, name: line.name });
          if (!line.unavailable) updateLine(line.lineId, { unavailable: true });
          continue;
        }
        if (line.unavailable) updateLine(line.lineId, { unavailable: false });
        const liveUnit =
          Number(item.price_mdl) +
          lineOptions.reduce((sum, o) => sum + Number(o!.price_delta_mdl), 0);
        if (liveUnit !== line.priceMdl) {
          repriced.push({ lineId: line.lineId, name: line.name, from: line.priceMdl, to: liveUnit });
          updateLine(line.lineId, { priceMdl: liveUnit });
        }
      }
      setResult({ repriced, dead, done: true });
    })();

    return () => {
      stale = true;
    };
  }, [lines, updateLine]);

  return result;
}
