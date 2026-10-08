// Pure connectivity logic (the NetInfo subscription lives in components/OfflineBanner.tsx).

export interface NetSnapshot {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
}

/** Offline only on a definite "no": null means NetInfo has not decided yet, and a banner
 *  flashing at every cold start would be worse than a late one. */
export function isOffline(s: NetSnapshot): boolean {
  return s.isConnected === false || s.isInternetReachable === false;
}

/** Turns a stream of NetInfo snapshots into flips: `onChange(offline)` fires only when the
 *  state changes. Starting from online, so `onChange(false)` always means "reconnected". */
export function trackConnectivity(onChange: (offline: boolean) => void) {
  let offline = false;
  return (s: NetSnapshot) => {
    const now = isOffline(s);
    if (now === offline) return;
    offline = now;
    onChange(now);
  };
}
