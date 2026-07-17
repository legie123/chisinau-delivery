"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import type { DispatchOffer } from "@/lib/types/domain";

// WS2 — the courier's live offer feed. A new dispatch_offers row (or a status
// change on theirs) refreshes the server-rendered page so the OfferCard appears
// within ~1s of mark_ready_for_pickup. Row-filtered by courier_id per the repo
// realtime rules; subscribeTable makes the channel name unique per mount.
export function OffersLive({ courierId }: { courierId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    return subscribeTable<DispatchOffer>(
      supabase,
      "courier-offers",
      "dispatch_offers",
      `courier_id=eq.${courierId}`,
      () => router.refresh(),
    );
  }, [courierId, router]);

  return null;
}
