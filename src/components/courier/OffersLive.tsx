"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import type { DispatchOffer } from "@/lib/types/domain";

// WS2 — the courier's live offer feed. A new dispatch_offers row (or a status
// change on theirs) refreshes the server-rendered page so the OfferCard appears
// within ~1s of mark_ready_for_pickup. Row-filtered by courier_id per the repo
// realtime rules; subscribeTable makes the channel name unique per mount and
// pauses/resumes this channel across pagehide/visibilitychange for bfcache
// eligibility.
//
// A dropped websocket here is costly: a courier who doesn't SEE a 30s offer lets
// it expire and gets ghost-penalised. On degradation we surface a banner and poll
// tightly (offers are short-lived) so the OfferCard still appears in time.
export function OffersLive({ courierId }: { courierId: string }) {
  const router = useRouter();
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    return subscribeTable<DispatchOffer>(
      supabase,
      "courier-offers",
      "dispatch_offers",
      `courier_id=eq.${courierId}`,
      () => router.refresh(),
      () => setDegraded(true), // onDegraded
      () => setDegraded(false), // onHealthy
    );
  }, [courierId, router]);

  // Tight poll while degraded — offers live only 30s, so 6s keeps them visible.
  useEffect(() => {
    if (!degraded) return;
    const id = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(id);
  }, [degraded, router]);

  if (!degraded) return null;
  // Banda era `fixed top-3`, deci ateriza PESTE antetul curierului — aceeași
  // clasă de defect reparată la partener în V1, dar acolo soluția a fost
  // mutarea în jos, iar la curier jos e zona degetului mare, unde stau oferta
  // și butonul de online (regula 2). Aici e altfel: stă în flux, la începutul
  // conținutului, deci nu poate acoperi nimic la nicio lățime — și rămâne
  // lipită sus la derulare, ca un curier care a coborât în listă să vadă tot
  // că e deconectat. Apare doar când websocket-ul chiar a căzut, deci
  // împingerea de conținut nu se vede în funcționarea normală.
  return (
    <div
      role="status"
      className="sticky top-0 z-40 -mx-5 mb-3 flex justify-center px-5 pt-1"
    >
      <span className="rounded-full bg-amber-500/15 px-4 py-1.5 text-xs font-medium text-amber-200 ring-1 ring-amber-400/30 backdrop-blur">
        Reconectare… ofertele se reîmprospătează automat
      </span>
    </div>
  );
}
