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
import { reconcileLines } from "@chisinau/shared-domain";

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

      const { repriced, dead } = reconcileLines(lines, items, options ?? []);
      const deadIds = new Set(dead.map((d) => d.lineId));
      for (const line of lines) {
        if (deadIds.has(line.lineId) !== Boolean(line.unavailable)) updateLine(line.lineId, { unavailable: deadIds.has(line.lineId) });
      }
      for (const r of repriced) updateLine(r.lineId, { priceMdl: r.to });
      setResult({ repriced, dead, done: true });
    })();

    return () => {
      stale = true;
    };
  }, [lines, updateLine]);

  return result;
}
