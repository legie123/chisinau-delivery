"use client";

import { useSyncExternalStore } from "react";

// Returns false during SSR + the first client render, true after hydration.
// useSyncExternalStore avoids the setState-in-effect lint trap. Gate any UI that
// reads localStorage-persisted state (the Zustand cart) on this so the server HTML
// (always the empty branch) matches the first client render — no hydration mismatch.
const emptySubscribe = () => () => {};

export function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
