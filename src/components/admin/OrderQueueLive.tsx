"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import type { Order } from "@/lib/types/domain";

// Refreshes the restaurant's order queue when anything changes on their
// orders — a server-refresh on realtime events keeps the page.tsx query the
// single source of truth instead of duplicating it client-side.
export function OrderQueueLive({ restaurantId }: { restaurantId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    return subscribeTable<Order>(supabase, "restaurant-queue", "orders", `restaurant_id=eq.${restaurantId}`, () => {
      router.refresh();
    });
  }, [restaurantId, router]);

  return null;
}
