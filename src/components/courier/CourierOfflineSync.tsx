"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { advanceStatus } from "@/app/(courier)/deliveries/actions";
import { drainPendingQueue, pendingQueueCount } from "@/lib/offline/statusQueue";

// Wave C — app-level offline drain + a global pending banner.
//
// The order-detail hook only drained when THAT page was mounted, so a courier
// who tapped "Am ridicat" in a dead zone and then navigated to the list left the
// change stuck — and `courier_has_capacity()` counted the phantom in-flight order
// against them, soft-locking new offers. Mounted once in the courier layout, this
// drains on every courier page: on mount, when the browser comes back online, and
// every 30s. A successful drain calls router.refresh() so the freshly caught-up
// state (freed capacity, advanced order) shows without a manual reload.
const DRAIN_INTERVAL_MS = 30_000;
const COUNT_POLL_MS = 4_000;

export function CourierOfflineSync() {
  const router = useRouter();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function drain() {
      const before = pendingQueueCount();
      if (before > 0) await drainPendingQueue(advanceStatus);
      if (cancelled) return;
      const after = pendingQueueCount();
      setPending(after);
      if (after < before) router.refresh(); // something drained → reflect the caught-up state
    }

    function syncCount() {
      if (!cancelled) setPending(pendingQueueCount());
    }

    // Defer the initial drain out of the effect body (avoids set-state-in-effect).
    void Promise.resolve().then(drain);

    window.addEventListener("online", drain);
    window.addEventListener("storage", syncCount); // cross-tab enqueue/drain
    const drainTimer = setInterval(drain, DRAIN_INTERVAL_MS);
    const countTimer = setInterval(syncCount, COUNT_POLL_MS); // keep the banner fresh for same-tab enqueues

    return () => {
      cancelled = true;
      window.removeEventListener("online", drain);
      window.removeEventListener("storage", syncCount);
      clearInterval(drainTimer);
      clearInterval(countTimer);
    };
  }, [router]);

  if (pending === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 bg-gold/15 px-4 py-2 text-center text-sm font-medium text-gold ring-1 ring-inset ring-gold/25"
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-gold" aria-hidden />
      {pending} {pending === 1 ? "acțiune în așteptare" : "acțiuni în așteptare"} — se sincronizează…
    </div>
  );
}
