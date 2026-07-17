"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/lib/orders/cart";

export type ReorderItem = { menuItemId: string; name: string; priceMdl: number; quantity: number };

// "Comandă din nou" on a delivered order — rebuilds the Zustand cart from that
// order's items and routes to /cart. Respects one-restaurant-per-cart: clear()
// first, then every line is the same restaurant, so the store never mixes.
export function ReorderButton({
  restaurantId,
  restaurantName,
  items,
}: {
  restaurantId: string;
  restaurantName: string;
  items: ReorderItem[];
}) {
  const router = useRouter();
  const clear = useCartStore((s) => s.clear);
  const addItem = useCartStore((s) => s.addItem);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const [busy, setBusy] = useState(false);

  function handleReorder() {
    if (busy || items.length === 0) return;
    setBusy(true);
    clear();
    for (const it of items) {
      addItem(restaurantId, restaurantName, { id: it.menuItemId, name: it.name, price_mdl: it.priceMdl });
      if (it.quantity > 1) setQuantity(it.menuItemId, it.quantity);
    }
    router.push("/cart");
  }

  return (
    <button
      type="button"
      onClick={handleReorder}
      disabled={busy || items.length === 0}
      className="flex items-center gap-2 self-start rounded-full bg-white/5 px-4 py-2 text-sm font-medium text-gold ring-1 ring-gold/30 transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span aria-hidden>🔁</span>
      {busy ? "Se pregătește coșul..." : "Comandă din nou"}
    </button>
  );
}
