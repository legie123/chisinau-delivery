"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import type { Order } from "@/lib/types/domain";

const ALERT_TITLE = "🔴 Comandă nouă!";
// Small inline SVG (no external asset) — a solid red dot used to flash the tab favicon.
const ALERT_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#e94560"/></svg>');

// Refreshes the restaurant's order queue when anything changes on their
// orders — a server-refresh on realtime events keeps the page.tsx query the
// single source of truth instead of duplicating it client-side.
//
// A new pending_restaurant row also starts an out-of-band alert (#8): the
// 7-minute accept SLA means a silent list update is easy to miss if the
// partner isn't staring at the screen. The alert (beep + flashing title +
// flashing favicon + best-effort Notification) stays active until the
// partner interacts with the page or the last pending order is resolved.
// pendingCount is optional — this component is also mounted on the catering
// page (out of scope here) purely for its live-refresh behavior, which never
// deals in pending_restaurant orders and so never raises the alert anyway.
// When omitted, the alert (once started) only clears on interaction.
export function OrderQueueLive({ restaurantId, pendingCount }: { restaurantId: string; pendingCount?: number }) {
  const router = useRouter();
  // Raw "a new order arrived and hasn't been acknowledged yet" signal. The
  // effective alert also requires pendingCount > 0 (derived below) so it
  // self-clears once the order is resolved (accepted/rejected/auto-cancelled)
  // without needing a setState call inside an effect body for that case.
  const [newOrderSignal, setNewOrderSignal] = useState(false);
  const alerting = newOrderSignal && (pendingCount === undefined || pendingCount > 0);
  // Realtime degradation: if the websocket drops (CHANNEL_ERROR/TIMED_OUT), the
  // queue would silently freeze on stale data — a restaurant would MISS orders.
  // We surface a banner + fall back to polling so new orders keep arriving.
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    return subscribeTable<Order>(
      supabase,
      "restaurant-queue",
      "orders",
      `restaurant_id=eq.${restaurantId}`,
      (payload) => {
        if (payload.eventType === "INSERT" && payload.new.status === "pending_restaurant") {
          setNewOrderSignal(true);
        }
        router.refresh();
      },
      () => setDegraded(true), // onDegraded
      () => setDegraded(false), // onHealthy (recovered)
    );
  }, [restaurantId, router]);

  // Polling fallback while degraded — keeps the queue fresh without realtime.
  useEffect(() => {
    if (!degraded) return;
    const id = setInterval(() => router.refresh(), 10000);
    return () => clearInterval(id);
  }, [degraded, router]);

  // Any interaction with the dashboard counts as "the partner has seen this".
  useEffect(() => {
    if (!alerting) return;
    const acknowledge = () => setNewOrderSignal(false);
    document.addEventListener("click", acknowledge, { once: true });
    document.addEventListener("keydown", acknowledge, { once: true });
    window.addEventListener("focus", acknowledge, { once: true });
    return () => {
      document.removeEventListener("click", acknowledge);
      document.removeEventListener("keydown", acknowledge);
      window.removeEventListener("focus", acknowledge);
    };
  }, [alerting]);

  // Audible ping, repeated — a muted tab or a partner not looking at the
  // screen still needs a chance to notice within the SLA window.
  useEffect(() => {
    if (!alerting) return;
    let ctx: AudioContext | null = null;
    const beep = () => {
      try {
        const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.45);
        const closeCtx = ctx;
        setTimeout(() => closeCtx.close().catch(() => {}), 600);
      } catch {
        // Web Audio blocked (autoplay policy, unsupported) — the visual cues still fire.
      }
    };
    beep();
    const id = setInterval(beep, 2500);
    return () => clearInterval(id);
  }, [alerting]);

  // Flashing tab title — visible even when the dashboard is a background tab.
  useEffect(() => {
    if (!alerting) return;
    const original = document.title;
    let showAlert = false;
    const id = setInterval(() => {
      document.title = showAlert ? original : ALERT_TITLE;
      showAlert = !showAlert;
    }, 1000);
    return () => {
      clearInterval(id);
      document.title = original;
    };
  }, [alerting]);

  // Flashing favicon — visible even when the dashboard tab isn't the active one.
  useEffect(() => {
    if (!alerting) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    const original = link.href;
    let showAlert = false;
    const id = setInterval(() => {
      link.href = showAlert ? original : ALERT_FAVICON;
      showAlert = !showAlert;
    }, 1000);
    return () => {
      clearInterval(id);
      link.href = original;
    };
  }, [alerting]);

  // Best-effort native Notification — only if the partner already granted
  // permission (never asks mid-alert; that would need a user gesture anyway).
  useEffect(() => {
    if (!alerting) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      try {
        new Notification("Comandă nouă!", {
          body: "O comandă nouă așteaptă confirmare — SLA de acceptare în curs.",
          tag: "new-order-alert",
        });
      } catch {
        // Notification constructor can throw in some contexts (e.g. no OS support) — non-fatal.
      }
    } else if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [alerting]);

  if (!degraded) return null;
  // Ancorat jos, nu sus (2026-08-16): la `top-3` banda cădea exact peste bara de
  // navigare a partenerului și scria peste „Program / Catering / Câștiguri" —
  // două texte suprapuse, dovedit în captura 1440×900. Panoul partenerului nu are
  // bară de jos, deci colțul de jos e liber la orice lățime, inclusiv pe telefon
  // unde antetul are două rânduri.
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full bg-amber-500/15 px-4 py-1.5 text-center text-xs font-medium text-amber-200 ring-1 ring-amber-400/30 backdrop-blur"
    >
      Reconectare la actualizări live… coada se reîmprospătează automat
    </div>
  );
}
