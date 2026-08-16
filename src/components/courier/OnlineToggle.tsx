"use client";

import { useState, useTransition } from "react";
import { setOnlineStatus } from "@/app/(courier)/deliveries/actions";

export function OnlineToggle({ initialStatus }: { initialStatus: string }) {
  const [online, setOnline] = useState(initialStatus === "online");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOnDelivery = initialStatus === "on_delivery";

  // Re-sync when the server re-renders with a fresh status (realtime refresh /
  // another tab) — adjust-during-render, same pattern as MenuItemRow.
  const [prevStatus, setPrevStatus] = useState(initialStatus);
  if (prevStatus !== initialStatus) {
    setPrevStatus(initialStatus);
    setOnline(initialStatus === "online");
  }

  function handleToggle() {
    const next = !online;
    setOnline(next);
    setFailed(false);
    setError(null);
    startTransition(async () => {
      const result = await setOnlineStatus(next);
      if (result.error) {
        setOnline(!next);
        setFailed(true);
        // Surface the RPC's own message — the cash-cap block
        // ("Plafon numerar atins…") is the whole point of the float feature;
        // "Reîncearcă" alone leaves the courier with no idea what to do.
        setError(result.error);
      }
    });
  }

  if (isOnDelivery) {
    return (
      <span className="flex items-center gap-2 rounded-full bg-blue-500/15 px-5 py-2.5 text-sm font-semibold text-blue-400 ring-1 ring-blue-500/30">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" aria-hidden />
        În livrare
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        // Auriul e rezervat banilor pe sectorul curier (§3 al rubricii), iar
        // verdele înseamnă „online". Butonul ăsta nu e niciuna: offline, e o
        // CHEMARE la online, nu o stare, deci verdele ar minți; iar auriu era
        // cel mai mare obiect auriu de pe ecran, adică se certa cu singura
        // cifră care chiar e bani („Azi ai câștigat"). Alb plin: rămâne cel mai
        // contrastant lucru de pe ecran, deci tot cea mai mare țintă de atins
        // (regula 2), fără să împrumute înțelesul altei culori.
        className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
          online
            ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
            : "bg-white text-[#0a0a14] ring-1 ring-white/80 hover:bg-white/90"
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${online ? "animate-pulse bg-emerald-400" : "bg-[#0a0a14]/40"}`} aria-hidden />
        {failed ? "Reîncearcă" : online ? "Online" : "Treci online"}
      </button>
      {error && <p className="max-w-[16rem] text-right text-xs text-amber-400">{error}</p>}
    </div>
  );
}
