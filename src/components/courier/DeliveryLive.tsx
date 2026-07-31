"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import type { Order } from "@/lib/types/domain";

// SurfaceAudit P2 — the courier delivery-detail page had no realtime. If an
// admin reassigns the order away (admin_reassign_courier), this refreshes the
// server render so the page reflects the loss of assignment instead of showing
// stale status + buttons that then fail an ownership check. Row-filtered by
// order id; subscribeTable handles unique channel naming + bfcache pause/resume.
export function DeliveryLive({ orderId }: { orderId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    return subscribeTable<Order>(
      supabase,
      "courier-delivery",
      "orders",
      `id=eq.${orderId}`,
      () => router.refresh(),
    );
  }, [orderId, router]);

  return null;
}
