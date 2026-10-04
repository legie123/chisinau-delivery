import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { fetchMyLiveOffer, subscribeMyDispatchOffers, userMessage, type DispatchOfferRow, type DriverOrder } from "../lib/api";
import { startOfferPoll } from "../lib/offerPoll";

export type LiveOffer = { offer: DispatchOfferRow; order: DriverOrder };

// The courier's single live offer, from THREE independent paths so one dead
// path never costs a 30s offer:
//   1. realtime postgres_changes on dispatch_offers (row-filtered courier_id);
//   2. a jittered ~10s poll while online (src/lib/offerPoll.ts);
//   3. a refetch whenever the app returns to the foreground (e.g. after the
//      courier taps the push notification).
export function useLiveOffer(courierId: string | null, enabled: boolean) {
  const [offer, setOffer] = useState<LiveOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [socketHealthy, setSocketHealthy] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Never throws: failures land in `error` (shown as a banner) and return false.
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const next = await fetchMyLiveOffer();
      if (mounted.current) {
        setOffer(next);
        setError(null);
      }
      return true;
    } catch (err) {
      if (mounted.current) setError(userMessage(err, "Nu am putut verifica ofertele."));
      return false;
    }
  }, []);

  useEffect(() => {
    if (!courierId || !enabled) {
      setOffer(null);
      return;
    }
    void load();
    const unsubscribe = subscribeMyDispatchOffers(courierId, () => void load(), setSocketHealthy);
    const poll = startOfferPoll(async () => {
      if (!(await load())) throw new Error("offer poll failed");
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => {
      unsubscribe();
      poll.stop();
      appState.remove();
    };
  }, [courierId, enabled, load]);

  return { offer, setOffer, error, socketHealthy, reload: load };
}
