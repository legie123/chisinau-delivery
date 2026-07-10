"use client";

import { useCartStore } from "@/lib/orders/cart";

export function AddToCartButton({
  restaurantId,
  restaurantName,
  item,
}: {
  restaurantId: string;
  restaurantName: string;
  item: { id: string; name: string; price_mdl: number };
}) {
  const addItem = useCartStore((s) => s.addItem);

  return (
    <button
      type="button"
      onClick={() => addItem(restaurantId, restaurantName, item)}
      className="rounded-full border border-zinc-300 px-3 py-1 text-xs transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      Adaugă
    </button>
  );
}
