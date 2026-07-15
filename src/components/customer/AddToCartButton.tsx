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
      className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-dark"
    >
      Adaugă
    </button>
  );
}
