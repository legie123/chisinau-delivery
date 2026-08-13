"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import type { DeliveryStatusEvent, Order } from "@/lib/types/domain";

// Keeps an order's status + status history live without a manual refresh —
// filtered by order id, not a whole-table subscription (fine for an internal
// admin tool, wrong for a customer-facing page at any real scale).
// Both channels below inherit subscribeTable()'s pagehide/visibilitychange
// pause+resume (bfcache eligibility) — no extra wiring needed here.
export function useOrderRealtime(orderId: string, initialOrder: Order, initialEvents: DeliveryStatusEvent[]) {
  const [order, setOrder] = useState(initialOrder);
  const [events, setEvents] = useState(initialEvents);

  // Keep state in sync when the server component re-renders with fresh props
  // (e.g. after a Server Action revalidates this route). Adjust-during-render
  // is React's recommended pattern for prop-driven state.
  const [prevInitialOrder, setPrevInitialOrder] = useState(initialOrder);
  if (prevInitialOrder !== initialOrder) {
    setPrevInitialOrder(initialOrder);
    setOrder(initialOrder);
  }
  const [prevInitialEvents, setPrevInitialEvents] = useState(initialEvents);
  if (prevInitialEvents !== initialEvents) {
    setPrevInitialEvents(initialEvents);
    setEvents(initialEvents);
  }

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

    // Dezbatere 2026-08-12, BUG confirmat: the hottest realtime surface (the
    // customer's tracking page) had NO fallback — a degraded websocket meant
    // a silently frozen page while the food moved. Low-frequency safety poll
    // (20s, active pre-terminal orders only, paused while tab is hidden):
    // realtime stays the fast path, the poll guarantees eventual truth.
    const TERMINAL = ["delivered", "cancelled", "rejected"];
    // armata 2026-08-13: clearInterval can't cancel an in-flight tick — a fetch
    // started just before unmount/orderId-change would setState with the OLD
    // order's data. The flag makes every await re-check liveness.
    let cancelled = false;
    const poll = setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      const [{ data: freshOrder }, { data: freshEvents }] = await Promise.all([
        supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
        supabase
          .from("delivery_status_events")
          .select("*")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      if (freshOrder) {
        setOrder((prev) => (prev.status !== (freshOrder as Order).status ? (freshOrder as Order) : prev));
        if (TERMINAL.includes((freshOrder as Order).status)) clearInterval(poll);
      }
      if (freshEvents) {
        setEvents((prev) => (freshEvents.length > prev.length ? (freshEvents as DeliveryStatusEvent[]) : prev));
      }
    }, 20_000);

    return () => {
      cancelled = true;
      unsubOrder();
      unsubEvents();
      clearInterval(poll);
    };
  }, [orderId]);

  return { order, events };
}
