"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import type { Order } from "@/lib/types/domain";

// The courier dashboard promises "rămâi online, te anunțăm" — this makes it
// true: any order reaching ready_for_pickup (or being taken by another
// courier) refreshes the server-rendered list.
export function AvailableOrdersLive() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    return subscribeTable<Order>(
      supabase,
      "courier-feed",
      "orders",
      "status=eq.ready_for_pickup",
      () => router.refresh(),
    );
  }, [router]);

  return null;
}
