"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cartLineId, useCartStore } from "@/lib/orders/cart";

export type ReorderItem = {
  menuItemId: string;
  name: string;
  priceMdl: number;
  quantity: number;
  optionIds: string[];
  optionsLabel: string;
  // true when the item's menu changed so a now-required option group is no longer
  // covered by the original choices — can't be one-click reordered, add from menu.
  blocked: boolean;
};

// "Comandă din nou" on a delivered order — rebuilds the Zustand cart from that
// order's items, REPLAYING each item's original modifier choices (selected_options
// snapshot) so a required-modifier dish (e.g. California Roll's "Sos") no longer
// dead-ends checkout. Items whose menu changed (blocked) are skipped with a notice
// pointing to the restaurant menu. Respects one-restaurant-per-cart via clear().
export function ReorderButton({
  restaurantId,
  restaurantName,
  restaurantSlug,
  items,
}: {
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string | null;
  items: ReorderItem[];
}) {
  const router = useRouter();
  const clear = useCartStore((s) => s.clear);
  const addItem = useCartStore((s) => s.addItem);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);

  function handleReorder() {
    if (busy || items.length === 0) return;
    setBusy(true);
    setSkipped([]);
    clear();

    const addable = items.filter((it) => !it.blocked);
    const blocked = items.filter((it) => it.blocked);

    for (const it of addable) {
      const options =
        it.optionIds.length > 0
          ? { optionIds: it.optionIds, optionsLabel: it.optionsLabel, unitPriceMdl: it.priceMdl }
          : undefined;
      addItem(restaurantId, restaurantName, { id: it.menuItemId, name: it.name, price_mdl: it.priceMdl }, options);
      if (it.quantity > 1) setQuantity(cartLineId(it.menuItemId, it.optionIds), it.quantity);
    }

    if (blocked.length > 0) {
      // Some items need re-configuring on the menu — tell the user, don't dead-end.
      setSkipped(blocked.map((b) => b.name));
      setBusy(false);
      if (addable.length === 0) {
        // Nothing could be re-added → send them to the menu to reconfigure.
        if (restaurantSlug) router.push(`/restaurants/${restaurantSlug}`);
        return;
      }
    }
    router.push("/cart");
  }

  return (
    <div className="flex flex-col gap-1.5 self-start">
      <button
        type="button"
        onClick={handleReorder}
        disabled={busy || items.length === 0}
        className="flex items-center gap-2 self-start rounded-full bg-white/5 px-4 py-2 text-sm font-medium text-gold ring-1 ring-gold/30 transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span aria-hidden>🔁</span>
        {busy ? "Se pregătește coșul..." : "Comandă din nou"}
      </button>
      {skipped.length > 0 && (
        <p className="text-xs text-white/50">
          {skipped.join(", ")} {skipped.length === 1 ? "are opțiuni noi" : "au opțiuni noi"} —{" "}
          {restaurantSlug ? (
            <a href={`/restaurants/${restaurantSlug}`} className="text-gold underline underline-offset-2">
              adaugă din meniu
            </a>
          ) : (
            "adaugă din meniu"
          )}
          .
        </p>
      )}
    </div>
  );
}
