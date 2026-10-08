"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cartSubtotal, useCartStore } from "@/lib/orders/cart";

// SSR renders "not hydrated" (pill hidden); after hydration the real cart
// shows. useSyncExternalStore avoids the setState-in-effect lint trap.
const emptySubscribe = () => () => {};
function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

// Bolt-style floating "View basket" pill — fixed bottom-center, appears on
// browsing pages whenever the cart has items. Hidden on cart/checkout where
// it would duplicate the page's own CTA.
export function FloatingBasket() {
  const pathname = usePathname();
  const { lines, restaurantName } = useCartStore();
  const hydrated = useHydrated();

  if (!hydrated || lines.length === 0) return null;
  if (pathname.startsWith("/cart") || pathname.startsWith("/checkout")) return null;

  const count = lines.reduce((sum, l) => sum + l.quantity, 0);
  const subtotal = cartSubtotal(lines);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h,0px)_+_1.5rem)] z-50 flex justify-center px-6">
      <Link
        href="/cart"
        className="pointer-events-auto flex w-full max-w-md items-center justify-between rounded-full bg-primary-dark px-6 py-4 text-white shadow-2xl shadow-primary/30 transition hover:bg-primary-darker"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
            {count}
          </span>
          <span className="text-[15px] font-semibold">Vezi coșul</span>
        </span>
        <span className="text-[15px] font-bold">
          {subtotal} MDL
          {restaurantName && <span className="ml-2 hidden text-xs font-normal text-white/70 sm:inline">· {restaurantName}</span>}
        </span>
      </Link>
    </div>
  );
}
