"use client";

import { useEffect, useState } from "react";
import { savePushSubscription } from "@/lib/push/actions";

// VAPID public key → Uint8Array for PushManager.subscribe.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// A discreet opt-in pill: registers the service worker, subscribes to Web Push,
// and saves the subscription. Hidden entirely if the browser can't do push or
// the user already granted (and is subscribed). Never blocks anything.
export function PushOptIn() {
  const [state, setState] = useState<"idle" | "unsupported" | "granted" | "working" | "error">("idle");

  useEffect(() => {
    // Deferred out of the effect body (rAF) so it isn't a synchronous
    // setState-in-effect (which the compiler flags as cascading).
    const raf = requestAnimationFrame(() => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported");
      } else if (Notification.permission === "granted") {
        setState("granted");
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  async function enable() {
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapid) return;
    setState("working");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("idle");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
        });
      }
      const json = sub.toJSON();
      await savePushSubscription({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent: navigator.userAgent,
      });
      setState("granted");
    } catch {
      setState("error");
    }
  }

  if (state === "unsupported" || state === "granted") return null;

  return (
    <button
      type="button"
      onClick={enable}
      disabled={state === "working"}
      className="flex w-full items-center justify-center gap-2 rounded-full bg-white/5 px-4 py-2.5 text-sm text-white/80 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
    >
      🔔 {state === "working" ? "Se activează…" : state === "error" ? "Reîncearcă notificările" : "Activează notificările"}
    </button>
  );
}
