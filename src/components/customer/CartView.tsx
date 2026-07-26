"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cartSubtotal, useCartStore } from "@/lib/orders/cart";
import { useHydrated } from "@/hooks/useHydrated";
import { createClient } from "@/lib/supabase/client";

export function CartView() {
  const { restaurantId, restaurantName, lines, setQuantity, removeItem } = useCartStore();
  const hydrated = useHydrated();
  // #9 — fetch the restaurant's fee + minimum so the cart can show the FULL total,
  // not just a subtotal the button implied was the total.
  const [summary, setSummary] = useState<{ delivery_fee_mdl: number; min_order_amount_mdl: number } | null>(null);
  useEffect(() => {
    if (!restaurantId) return;
    let stale = false;
    createClient()
      .from("restaurants")
      .select("delivery_fee_mdl, min_order_amount_mdl")
      .eq("id", restaurantId)
      .single()
      .then(({ data }) => {
        if (!stale) setSummary(data);
      });
    return () => {
      stale = true;
    };
  }, [restaurantId]);

  // Until hydrated, render the same empty branch the server did (the persisted
  // cart isn't available server-side) — prevents a hydration mismatch/flash.
  if (!hydrated || !restaurantId || lines.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <span className="text-6xl" aria-hidden>🛒</span>
        <p className="text-white/60">Coșul tău este gol.</p>
        <Link
          href="/restaurants"
          className="rounded-full bg-primary-dark px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-darker"
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
          <span className="font-semibold">{subtotal} MDL</span>
        </div>
        {summary && (
          <>
            <div className="mt-1.5 flex items-center justify-between text-sm text-white/60">
              <span>Livrare</span>
              <span>{Number(summary.delivery_fee_mdl) === 0 ? "Gratuită" : `${summary.delivery_fee_mdl} MDL`}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
              <span className="font-medium">Total</span>
              <span className="text-lg font-bold text-gold">{subtotal + Number(summary.delivery_fee_mdl)} MDL</span>
            </div>
            {subtotal < Number(summary.min_order_amount_mdl) && (
              <p className="mt-2 text-xs text-primary">
                Comandă minimă {summary.min_order_amount_mdl} MDL — mai adaugă{" "}
                {Number(summary.min_order_amount_mdl) - subtotal} MDL.
              </p>
            )}
          </>
        )}
        <p className="mt-1 text-xs text-white/40">Bacșișul (opțional) se adaugă la checkout.</p>
      </div>

      <Link
        href="/checkout"
        aria-disabled={summary ? subtotal < Number(summary.min_order_amount_mdl) : undefined}
        className={`rounded-full py-4 text-center text-[15px] font-semibold text-white transition ${
          summary && subtotal < Number(summary.min_order_amount_mdl)
            ? "pointer-events-none bg-white/10 text-white/40"
            : "bg-primary-dark hover:bg-primary-darker"
        }`}
      >
        {summary
          ? subtotal < Number(summary.min_order_amount_mdl)
            ? "Comandă sub minim"
            : `Continuă spre plată · ${subtotal + Number(summary.delivery_fee_mdl)} MDL`
          : `Continuă spre plată · ${subtotal} MDL`}
      </Link>
    </div>
  );
}
