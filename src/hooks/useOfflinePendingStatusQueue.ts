"use client";

import { useEffect, useState } from "react";
import {
  type AdvanceFn,
  type PendingStatusChange,
  drainPendingQueue,
  enqueueStatusChange,
  hasPendingChange,
  isNetworkError,
} from "@/lib/offline/statusQueue";

// Wires the offline status queue into a component's lifecycle: drains
// whatever is pending on mount and whenever the browser comes back online,
// and exposes `advanceOrEnqueue` — a drop-in replacement for calling the
// Server Action directly that persists the intended change instead of
// losing it when the call fails for network reasons (see statusQueue.ts).
export function useOfflinePendingStatusQueue(orderId: string, advance: AdvanceFn) {
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    // Drain on mount (covers "opened the app back online") and on the
    // browser's online event; both routes update `queued` from the promise
    // callback rather than synchronously in the effect body.
    function drain() {
      void drainPendingQueue(advance)
        .then(() => hasPendingChange(orderId))
        .then(setQueued);
    }

    drain();
    window.addEventListener("online", drain);
    return () => window.removeEventListener("online", drain);
    // advance is the stable Server Action import; only orderId should re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // enqueue rejects (Romanian message) when storage can't be read; return it inline like the
  // app does instead of throwing into the caller's transition (error boundary).
  async function enqueue(entry: PendingStatusChange): Promise<{ error: string | null }> {
    try {
      await enqueueStatusChange(entry);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Nu am putut salva acțiunea offline. Încearcă din nou." };
    }
    setQueued(true);
    return { error: null };
  }

  async function advanceOrEnqueue(newStatus: string, paymentConfirmed?: boolean): Promise<{ error: string | null }> {
    const entry: PendingStatusChange = { orderId, newStatus, paymentConfirmed, ts: Date.now() };

    if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
      return enqueue(entry);
    }

    try {
      return await advance(orderId, newStatus, paymentConfirmed);
    } catch (err) {
      if (isNetworkError(err)) return enqueue(entry);
      throw err;
    }
  }

  return { queued, advanceOrEnqueue };
}
