"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { advanceStatus } from "@/app/(courier)/deliveries/actions";
import { clearGiveUpCount, drainPendingQueue, giveUpCount, pendingQueueCount } from "@/lib/offline/statusQueue";

// Wave C — app-level offline drain + a global pending banner.
//
// The order-detail hook only drained when THAT page was mounted, so a courier
// who tapped "Am ridicat" in a dead zone and then navigated to the list left the
// change stuck — and `courier_has_capacity()` counted the phantom in-flight order
// against them, soft-locking new offers. Mounted once in the courier layout, this
// drains on every courier page: on mount, when the browser comes back online,
// when the tab becomes visible again (a courier reopening the app after
// backgrounding it is exactly when connectivity is likely to have changed),
// and every 30s. A successful drain calls router.refresh() so the freshly
// caught-up state (freed capacity, advanced order) shows without a manual
// reload. A second, discreet banner surfaces entries the queue gave up on
// (statusQueue.ts drops anything over 24h old / 8 attempts) so a courier
// isn't left wondering why a tap silently never took effect.
const DRAIN_INTERVAL_MS = 30_000;
const COUNT_POLL_MS = 4_000;

export function CourierOfflineSync() {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [givenUp, setGivenUp] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function drain() {
      const before = await pendingQueueCount();
      if (before > 0) await drainPendingQueue(advanceStatus);
      const [after, stuck] = await Promise.all([pendingQueueCount(), giveUpCount()]);
      if (cancelled) return;
      setPending(after);
      setGivenUp(stuck);
      if (after < before) router.refresh(); // something drained → reflect the caught-up state
    }

    function syncCount() {
      void Promise.all([pendingQueueCount(), giveUpCount()]).then(([count, stuck]) => {
        if (cancelled) return;
        setPending(count);
        setGivenUp(stuck);
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void drain();
    }

    // Defer the initial drain out of the effect body (avoids set-state-in-effect).
    void Promise.resolve().then(drain);

    window.addEventListener("online", drain);
    window.addEventListener("storage", syncCount); // cross-tab enqueue/drain
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const drainTimer = setInterval(drain, DRAIN_INTERVAL_MS);
    const countTimer = setInterval(syncCount, COUNT_POLL_MS); // keep the banner fresh for same-tab enqueues

    return () => {
      cancelled = true;
      window.removeEventListener("online", drain);
      window.removeEventListener("storage", syncCount);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(drainTimer);
      clearInterval(countTimer);
    };
  }, [router]);

  function dismissGiveUp() {
    // Clear only what the banner showed — a give-up recorded since stays for the next one.
    void clearGiveUpCount(givenUp).then(giveUpCount).then(setGivenUp);
    setGivenUp(0);
  }

  if (pending === 0 && givenUp === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {pending > 0 && (
        <div
          role="status"
          aria-live="polite"
          // O acțiune care așteaptă sincronizarea nu e o sumă — auriul de pe
          // sectorul curier înseamnă bani (§3), iar banda asta apărea exact
          // deasupra cardului cu câștigul zilei, în aceeași culoare.
          className="flex items-center justify-center gap-2 bg-white/10 px-4 py-2 text-center text-sm font-medium text-white ring-1 ring-inset ring-white/15"
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white/70" aria-hidden />
          {pending} {pending === 1 ? "acțiune în așteptare" : "acțiuni în așteptare"} — se sincronizează…
        </div>
      )}
      {givenUp > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 bg-primary/10 px-4 py-1.5 text-center text-xs font-medium text-primary ring-1 ring-inset ring-primary/20"
        >
          <span>
            {givenUp} {givenUp === 1 ? "acțiune nu s-a putut sincroniza" : "acțiuni nu s-au putut sincroniza"} —
            verifică conexiunea
          </span>
          <button type="button" onClick={dismissGiveUp} className="underline underline-offset-2 hover:opacity-80">
            Am înțeles
          </button>
        </div>
      )}
    </div>
  );
}
