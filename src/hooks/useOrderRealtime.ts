"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import type { DeliveryStatusEvent, Order } from "@/lib/types/domain";

// Keeps an order's status + status history live without a manual refresh —
// filtered by order id, not a whole-table subscription (fine for an internal
// admin tool, wrong for a customer-facing page at any real scale).
export function useOrderRealtime(orderId: string, initialOrder: Order, initialEvents: DeliveryStatusEvent[]) {
  const [order, setOrder] = useState(initialOrder);
  const [events, setEvents] = useState(initialEvents);

  useEffect(() => {
    const supabase = createClient();

    const unsubOrder = subscribeTable<Order>(supabase, "order-status", "orders", `id=eq.${orderId}`, (payload) => {
      if (payload.new && "id" in payload.new) setOrder(payload.new as Order);
    });

    const unsubEvents = subscribeTable<DeliveryStatusEvent>(
      supabase,
      "order-events",
      "delivery_status_events",
      `order_id=eq.${orderId}`,
      (payload) => {
        if (payload.eventType === "INSERT" && payload.new && "id" in payload.new) {
          setEvents((prev) => [...prev, payload.new as DeliveryStatusEvent]);
        }
      },
    );

    return () => {
      unsubOrder();
      unsubEvents();
    };
  }, [orderId]);

  return { order, events };
}
