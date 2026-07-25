"use client";

import { useEffect } from "react";

// Registers the service worker unconditionally on load so the app meets PWA
// install criteria (a controlling SW + manifest) for every visitor — install
// prompts shouldn't depend on the user having opted into push notifications.
// PushOptIn (src/components/shared/PushOptIn.tsx) also registers /sw.js, but
// only after the user taps "Activează notificările"; registration is
// idempotent (same scope → the existing registration is reused), and push
// subscription itself stays opt-in and untouched here.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Install criteria just won't be met this visit — never block rendering.
    });
  }, []);

  return null;
}
