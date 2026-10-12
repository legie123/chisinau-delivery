"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import { ReconnectNotice } from "@/components/shared/ReconnectNotice";
import { kitchenAlertAudio } from "@/lib/kitchen/alertAudio";
import { duePending, newArrivals, type PendingOrder } from "@/lib/kitchen/queueAlarm";
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
// flashing favicon + best-effort Notification) stays active while an order is
// due (accept clock running) — a tap does not silence it, Accept/Reject does.
// `pending` is optional — this component is also mounted on the catering page
// purely for its live-refresh behavior; without it there is no alarm.
// G2 (2026-10-12, measured with a real socket cut): the alarm used to start only on a
// realtime INSERT and stop on any tap, and the degraded-mode poll called router.refresh()
// offline — Next then hard-navigated, the service worker swapped the queue for its offline
// screen, and after reconnect the reloaded page had sound locked: the order arrived silently.
// Now the alarm is derived from the queue (due orders ring until Accept/Reject), every
// refresh first probes the network, and the page stays alive through the outage.
export function OrderQueueLive({
  restaurantId,
  pending,
  // Pastila de conexiune, redată INLINE acolo unde stă componenta. Pagina de
  // comenzi avea o pastilă „● Live" scrisă de mână lângă titlu, iar componenta
  // asta — care ȘTIE când conexiunea a căzut — arăta în același timp banda
  // „Reconectare la actualizări live…". Ambele se vedeau în aceeași captură
  // (1440×900, 2026-08-16): ecranul se contrazicea singur. Semnalul e acum
  // unul singur, luat de la sursă.
  showConnection = false,
}: {
  restaurantId: string;
  /** The queue's pending_restaurant orders (orders page only; catering omits it). */
  pending?: PendingOrder[];
  showConnection?: boolean;
}) {
  const router = useRouter();
  // Two alarm sources: due orders (ring until acted on) and a not-yet-acknowledged new
  // arrival (e.g. a scheduled order: rings until the first tap).
  // Ids of new arrivals not yet acknowledged — per order, so an order accepted elsewhere stops
  // ringing here even while other orders are pending (verifier F2).
  const [arrivedIds, setArrivedIds] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(Date.now);
  const dueCount = pending ? duePending(pending, now).length : 0;
  const arrivalSignal = (pending ?? []).some((o) => arrivedIds.has(o.id));
  const alerting = dueCount > 0 || arrivalSignal;
  const [netDown, setNetDown] = useState(false);
  const [epoch, setEpoch] = useState(0); // bumped on "online" → fresh realtime subscription
  const seenRef = useRef<Set<string> | null>(null);
  // Realtime degradation: if the websocket drops (CHANNEL_ERROR/TIMED_OUT), the
  // queue would silently freeze on stale data — a restaurant would MISS orders.
  // We surface a banner + fall back to polling so new orders keep arriving.
  // Trei stări, nu două: până când abonarea nu confirmă (SUBSCRIBED), nu avem
  // dreptul să scriem „Live" — necunoscut nu se rotunjește la bine.
  const [connection, setConnection] = useState<"connecting" | "live" | "degraded">("connecting");
  const degraded = connection === "degraded";
  // Sound needs one tap per page load (lib/kitchen/alertAudio). Until then the queue shows the
  // unlock button rather than a beep that silently never plays.
  const [soundOn, setSoundOn] = useState(false);
  const [wakeLockOn, setWakeLockOn] = useState<boolean | null>(null);

  // Kitchen tablet: keep the screen on while the queue is open (showConnection = the orders
  // page, not catering). The browser drops the lock when the tab hides; re-acquire on return.
  useEffect(() => {
    if (!showConnection || typeof navigator === "undefined") return;
    let disposed = false;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      // Unsupported (older Safari) rejects like a refused request: both end in "may sleep".
      (navigator.wakeLock ? navigator.wakeLock.request("screen") : Promise.reject(new Error("unsupported")))
        .then((l) => {
          if (disposed) return void l.release().catch(() => {});
          void lock?.release().catch(() => {});
          lock = l;
          setWakeLockOn(true);
          l.addEventListener("release", () => !disposed && setWakeLockOn(false));
        })
        .catch(() => setWakeLockOn(false));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [showConnection]);

  // Refresh only after a same-origin probe succeeds: router.refresh() while offline makes
  // Next fall back to a full navigation, which loses the page and its unlocked sound.
  const safeRefresh = useCallback(async () => {
    try {
      // Probe with the very request router.refresh() makes (RSC render of this page: Next
      // server + Supabase). A static asset or a separate ping passed while the render 503'd,
      // and Next then hard-navigated, losing the unlocked sound (verifier F3).
      const r = await fetch(window.location.pathname, { headers: { RSC: "1" }, cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      setNetDown(true);
      return;
    }
    setNetDown(false);
    router.refresh();
  }, [router]);

  useEffect(() => {
    const supabase = createClient();
    let wasDegraded = false;
    return subscribeTable<Order>(
      supabase,
      "restaurant-queue",
      "orders",
      `restaurant_id=eq.${restaurantId}`,
      () => void safeRefresh(),
      () => {
        wasDegraded = true;
        setConnection("degraded");
      },
      () => {
        setConnection("live");
        // Catch-up: events missed while the socket was down are not replayed.
        if (wasDegraded) void safeRefresh();
        wasDegraded = false;
      },
    );
  }, [restaurantId, safeRefresh, epoch]);

  // Back online: resubscribe now (don't wait for the socket's backoff) and catch up.
  useEffect(() => {
    const onOnline = () => {
      setEpoch((e) => e + 1);
      void safeRefresh();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [safeRefresh]);

  // Polling: every 10 s while realtime isn't confirmed live (or the probe failed), and a 20 s
  // safety net even while "Live" — a lost postgres_changes frame (seen right after a stack
  // restart) otherwise never reaches the screen (verifier F4).
  useEffect(() => {
    const ms = connection === "live" && !netDown ? 20000 : 10000;
    const id = setInterval(() => void safeRefresh(), ms);
    return () => clearInterval(id);
  }, [connection, netDown, safeRefresh]);

  // Clock for "due": a scheduled order starts ringing 60 min before its window.
  useEffect(() => {
    if (!pending?.length) return;
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, [pending?.length]);

  // New arrivals (by id, so polling and reloads count too — not only realtime INSERTs).
  const pendingKey = (pending ?? []).map((o) => o.id).join(",");
  useEffect(() => {
    if (!pending) return;
    const fresh = newArrivals(pending, seenRef.current);
    seenRef.current = new Set(pending.map((o) => o.id));
    if (fresh.length === 0) return;
    setArrivedIds((prev) => new Set([...prev, ...fresh]));
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Comandă nouă!", {
          body: "O comandă nouă așteaptă confirmare — SLA de acceptare în curs.",
          tag: "new-order-alert",
        });
      } catch {
        // Notification constructor can throw in some contexts (e.g. no OS support) — non-fatal.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id list
  }, [pendingKey]);

  // A tap acknowledges a NEW ARRIVAL that isn't due yet (a scheduled order). It never
  // silences a due order: that rings until Accept/Reject removes it from the queue.
  useEffect(() => {
    if (!arrivalSignal) return;
    const acknowledge = () => setArrivedIds(new Set());
    document.addEventListener("click", acknowledge, { once: true });
    document.addEventListener("keydown", acknowledge, { once: true });
    window.addEventListener("focus", acknowledge, { once: true });
    return () => {
      document.removeEventListener("click", acknowledge);
      document.removeEventListener("keydown", acknowledge);
      window.removeEventListener("focus", acknowledge);
    };
  }, [arrivalSignal]);

  // Audible ping, repeated — a muted tab or a partner not looking at the
  // screen still needs a chance to notice within the SLA window. A beep that
  // could not play (sound locked again) brings the unlock button back.
  useEffect(() => {
    if (!alerting) return;
    const beep = () => {
      if (!kitchenAlertAudio.beep()) setSoundOn(false);
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

  // Ask once for notification permission while ringing (needs no gesture to *ask* on most browsers).
  useEffect(() => {
    if (!alerting || typeof Notification === "undefined") return;
    if (Notification.permission === "default") Notification.requestPermission().catch(() => {});
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

  // Sound is locked (e.g. the page was reloaded) while an order is ringing: the beep
  // can't play, so the whole screen asks for the one tap that restores it.
  const soundLockedOverlay =
    showConnection && alerting && !soundOn ? (
      <button
        type="button"
        onClick={() => {
          void kitchenAlertAudio.unlock().then(() => setSoundOn(kitchenAlertAudio.running()));
        }}
        className="fixed inset-0 z-50 flex animate-pulse flex-col items-center justify-center gap-3 bg-primary/90 text-center text-white"
      >
        <span className="text-5xl" aria-hidden>🔔</span>
        <span className="font-serif text-3xl font-bold">Comandă nouă</span>
        <span className="text-base">Atinge ecranul ca să pornești sunetul</span>
      </button>
    ) : null;

  const netBanner =
    showConnection && netDown ? (
      <div role="status" className="w-full rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-100 ring-1 ring-amber-400/30">
        Fără internet — nu închide aplicația. Comenzile noi apar și sună singure când revine semnalul.
      </div>
    ) : null;

  const kitchenControls = showConnection ? (
    <span className="inline-flex flex-wrap items-center gap-2">
      {!soundOn && (
        <button
          type="button"
          onClick={() => {
            void kitchenAlertAudio.unlock().then(() => setSoundOn(kitchenAlertAudio.running()));
          }}
          className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-primary/40"
        >
          🔔 Activează sunetul pentru comenzi noi
        </button>
      )}
      {wakeLockOn === false && (
        <span className="text-xs text-amber-200" title="Browserul nu poate ține ecranul aprins; setează tableta să nu se stingă.">
          Ecranul se poate stinge
        </span>
      )}
    </span>
  ) : null;

  if (!degraded)
    return (
      <>
        {pill}
        {kitchenControls}
        {netBanner}
        {soundLockedOverlay}
      </>
    );
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
    <>
      {kitchenControls}
      {netBanner}
      {soundLockedOverlay}
      <div className="w-full">
        <ReconnectNotice detail="coada se reîmprospătează automat" placement="flow" />
      </div>
    </>
  );
}
