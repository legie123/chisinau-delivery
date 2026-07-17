"use client";

import Link from "next/link";
import { cartSubtotal, useCartStore } from "@/lib/orders/cart";
import { useHydrated } from "@/hooks/useHydrated";

export function CartView() {
  const { restaurantId, restaurantName, lines, setQuantity, removeItem } = useCartStore();
  const hydrated = useHydrated();

  // Until hydrated, render the same empty branch the server did (the persisted
  // cart isn't available server-side) — prevents a hydration mismatch/flash.
  if (!hydrated || !restaurantId || lines.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <span className="text-6xl" aria-hidden>🛒</span>
        <p className="text-white/60">Coșul tău este gol.</p>
        <Link
          href="/restaurants"
          className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-dark"
        >
          Vezi restaurantele
        </Link>
      </div>
    );
  }

  const subtotal = cartSubtotal(lines);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">{restaurantName}</h2>
        <ul className="flex flex-col gap-4">
          {lines.map((line) => (
            <li key={line.menuItemId} className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-white">{line.name}</p>
                <p className="text-sm text-white/50">{line.priceMdl} MDL</p>
              </div>
              {/* Bolt-style quantity stepper */}
              <div className="flex items-center gap-1 rounded-full bg-white/5 p-1 ring-1 ring-white/10">
                <button
                  type="button"
                  onClick={() => setQuantity(line.menuItemId, line.quantity - 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-white/80 transition hover:bg-white/10"
                  aria-label="Scade cantitatea"
                >
                  −
                </button>
                <span className="w-7 text-center text-sm font-bold text-white">{line.quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(line.menuItemId, line.quantity + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-white/80 transition hover:bg-white/10"
                  aria-label="Crește cantitatea"
                >
                  +
                </button>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="w-20 text-right font-semibold text-white">{line.priceMdl * line.quantity} MDL</span>
                <button
                  type="button"
                  onClick={() => removeItem(line.menuItemId)}
                  className="text-xs text-white/40 underline underline-offset-4 transition hover:text-primary"
                >
                  Șterge
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <div className="flex items-center justify-between text-white">
          <span className="font-medium">Subtotal</span>
          <span className="text-lg font-bold">{subtotal} MDL</span>
        </div>
        <p className="mt-1 text-xs text-white/40">Taxa de livrare se adaugă la checkout.</p>
      </div>

      <Link
        href="/checkout"
        className="rounded-full bg-primary py-4 text-center text-[15px] font-semibold text-white transition hover:bg-primary-dark"
      >
        Continuă spre plată · {subtotal} MDL
      </Link>
    </div>
  );
}
