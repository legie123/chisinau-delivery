"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import { ReconnectNotice } from "@/components/shared/ReconnectNotice";
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
export function OrderQueueLive({
  restaurantId,
  pendingCount,
  // Pastila de conexiune, redată INLINE acolo unde stă componenta. Pagina de
  // comenzi avea o pastilă „● Live" scrisă de mână lângă titlu, iar componenta
  // asta — care ȘTIE când conexiunea a căzut — arăta în același timp banda
  // „Reconectare la actualizări live…". Ambele se vedeau în aceeași captură
  // (1440×900, 2026-08-16): ecranul se contrazicea singur. Semnalul e acum
  // unul singur, luat de la sursă.
  showConnection = false,
}: {
  restaurantId: string;
  pendingCount?: number;
  showConnection?: boolean;
}) {
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
  // Trei stări, nu două: până când abonarea nu confirmă (SUBSCRIBED), nu avem
  // dreptul să scriem „Live" — necunoscut nu se rotunjește la bine.
  const [connection, setConnection] = useState<"connecting" | "live" | "degraded">("connecting");
  const degraded = connection === "degraded";

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
      () => setConnection("degraded"), // onDegraded
      () => setConnection("live"), // onHealthy (SUBSCRIBED / recuperat)
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

  const pill = showConnection ? (
    connection === "live" ? (
      <span className="pg-amethyst-glow inline-flex items-center gap-1.5 text-xs font-medium">
        <span className="pg-live-dot" aria-hidden /> Live
      </span>
    ) : (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-200"
        title={
          connection === "connecting"
            ? "Se caută conexiunea cu actualizările live"
            : "Conexiunea live a căzut — coada se reîmprospătează prin verificare periodică"
        }
      >
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400/80" aria-hidden />
        {connection === "connecting" ? "Se conectează…" : "Reconectare…"}
      </span>
    )
  ) : null;

  if (!degraded) return pill;
  // A treia plasare a acestei benzi, și de data asta măsurată, nu aleasă.
  // Istoric: `fixed top-3` scria peste „Program / Catering / Câștiguri" (1440,
  // V1), deci a fost mutată la `fixed bottom-4` — „colțul de jos e liber la
  // orice lățime". Nu e: colțul de jos al FERESTREI e liber doar cât timp
  // pagina nu se derulează. Pe coada partenerului se derulează, iar
  // `scripts/overflow-audit.mjs` a găsit banda peste titlul „Ultimele 30 de
  // zile" (195×12 px) și, cu coada goală, peste butonul „Activează
  // notificările" — adică peste o ACȚIUNE.
  //
  // Plasarea `flow` a benzii comune e singura care nu poate acoperi nimic la
  // nicio lățime, fiindcă stă în flux și își rezervă singură spațiul; e
  // lecția câștigată pe ecranul curierului în V5. Wrapper-ul `w-full` o scoate
  // pe propriul rând din rândul de titlu (părintele are `flex-wrap`).
  //
  // Fără pastilă: banda spune ACELAȘI lucru, mai complet. Cât timp banda
  // plutea în colțul de jos, cele două semnale erau la două ecrane distanță și
  // duplicarea nu se vedea; aduse una sub alta, captura arată „Reconectare…"
  // de două ori în aceeași privire. Un singur semnal, cel care explică și ce
  // se întâmplă mai departe.
  return (
    <div className="w-full">
      <ReconnectNotice detail="coada se reîmprospătează automat" placement="flow" />
    </div>
  );
}
