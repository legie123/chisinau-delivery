import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import { drainStatusQueue, statusQueue } from "../lib/offlineQueue";

const DRAIN_INTERVAL_MS = 30_000;
const COUNT_POLL_MS = 4_000; // same-session enqueues show up in the banner within seconds

// App-level replay of queued status changes (mirrors the web's
// CourierOfflineSync): drain on launch, when the network comes back, when the
// app returns to the foreground, and every 30s.
export function useOfflineSync(enabled: boolean) {
  const [pending, setPending] = useState(0);
  const [givenUp, setGivenUp] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let draining = false;

    async function refreshCounts() {
      const [p, g] = await Promise.all([statusQueue.count(), statusQueue.giveUpCount()]);
      if (!cancelled) {
        setPending(p);
        setGivenUp(g);
      }
    }

    async function sync() {
      if (draining) return;
      draining = true;
      try {
        if ((await statusQueue.count()) > 0) await drainStatusQueue();
      } finally {
        draining = false;
      }
      await refreshCounts();
    }

    void sync();
    const net = Network.addNetworkStateListener((state) => {
      if (state.isConnected) void sync();
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    const drainTimer = setInterval(() => void sync(), DRAIN_INTERVAL_MS);
    const countTimer = setInterval(() => void refreshCounts(), COUNT_POLL_MS);

    return () => {
      cancelled = true;
      net.remove();
      appState.remove();
      clearInterval(drainTimer);
      clearInterval(countTimer);
    };
  }, [enabled]);

  const dismissGiveUp = useCallback(async () => {
    await statusQueue.clearGiveUpCount();
    setGivenUp(0);
  }, []);

  return { pending, givenUp, dismissGiveUp };
}
