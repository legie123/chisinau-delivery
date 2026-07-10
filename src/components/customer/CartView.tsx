"use client";

import Link from "next/link";
import { cartSubtotal, useCartStore } from "@/lib/orders/cart";

export function CartView() {
  const { restaurantId, restaurantName, lines, setQuantity, removeItem } = useCartStore();

  if (!restaurantId || lines.length === 0) {
    return (
      <div>
        <p className="mb-4 text-zinc-500">Coșul tău este gol.</p>
        <Link href="/restaurants" className="text-sm underline underline-offset-4">
          Vezi restaurantele
        </Link>
      </div>
    );
  }

  const subtotal = cartSubtotal(lines);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-zinc-500">{restaurantName}</h2>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li
            key={line.menuItemId}
            className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
          >
            <span>{line.name}</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity(line.menuItemId, line.quantity - 1)}
                  className="h-6 w-6 rounded-full border border-zinc-300 dark:border-zinc-700"
                >
                  –
                </button>
                <span className="w-6 text-center text-sm">{line.quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(line.menuItemId, line.quantity + 1)}
                  className="h-6 w-6 rounded-full border border-zinc-300 dark:border-zinc-700"
                >
                  +
                </button>
              </div>
              <span className="w-20 text-right text-sm text-zinc-500">{line.priceMdl * line.quantity} MDL</span>
              <button
                type="button"
                onClick={() => removeItem(line.menuItemId)}
                className="text-xs text-red-600 underline underline-offset-4"
              >
                Șterge
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <span className="font-medium">Subtotal</span>
        <span className="font-medium">{subtotal} MDL</span>
      </div>
      <Link
        href="/checkout"
        className="w-fit rounded-full bg-zinc-900 px-6 py-3 text-sm text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
      >
        Continuă spre plată
      </Link>
    </div>
  );
}
