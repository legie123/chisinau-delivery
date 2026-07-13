"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import { cancelCateringOrder, confirmCateringQuote } from "@/app/(customer)/catering/actions";
import {
  ORDER_STATUS_LABEL,
  type CateringDetails,
  type Order,
  type OrderItem,
} from "@/lib/types/domain";

const QUOTE_LABEL: Record<CateringDetails["quote_status"], string> = {
  requested: "Cerere trimisă — așteptăm oferta restaurantului",
  quoted: "Ofertă primită — confirmă ca să intre în lucru",
  confirmed: "Ofertă confirmată — comanda e în lucru",
  declined: "Restaurantul a refuzat cererea",
};

export function CateringTracking({
  initialOrder,
  initialDetails,
  items,
}: {
  initialOrder: Order;
  initialDetails: CateringDetails;
  items: OrderItem[];
}) {
  const [order, setOrder] = useState(initialOrder);
  const [details, setDetails] = useState(initialDetails);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const unsubOrder = subscribeTable<Order>(supabase, "catering-order", "orders", `id=eq.${order.id}`, (payload) => {
      if (payload.new && "id" in payload.new) setOrder(payload.new as Order);
    });
    const unsubDetails = subscribeTable<CateringDetails>(
      supabase,
      "catering-details",
      "catering_details",
      `order_id=eq.${order.id}`,
      (payload) => {
        if (payload.new && "order_id" in payload.new) setDetails(payload.new as CateringDetails);
      },
    );
    return () => {
      unsubOrder();
      unsubDetails();
    };
  }, [order.id]);

  function handleConfirm() {
    startTransition(async () => {
      try {
        await confirmCateringQuote(order.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Eroare");
      }
    });
  }

  function handleCancel() {
    const reason = window.prompt("Motivul anulării (opțional):") ?? "";
    startTransition(async () => {
      try {
        await cancelCateringOrder(order.id, reason);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Eroare");
      }
    });
  }

  const isTerminal = order.status === "cancelled" || order.status === "rejected";

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm font-medium">
          {isTerminal ? ORDER_STATUS_LABEL[order.status] : QUOTE_LABEL[details.quote_status]}
        </p>
        {isTerminal && order.cancellation_reason && (
          <p className="mt-1 text-sm text-zinc-500">{order.cancellation_reason}</p>
        )}
        {details.quote_status === "confirmed" && !isTerminal && (
          <p className="mt-1 text-sm text-zinc-500">
            Status livrare: {ORDER_STATUS_LABEL[order.status]}
          </p>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-2 font-medium">Eveniment</h2>
          <p>
            {details.event_date}
            {details.event_time ? ` · ${details.event_time.slice(0, 5)}` : ""} · {details.guest_count} invitați
          </p>
          <p className="text-zinc-500">{details.event_address_text}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-2 font-medium">Contact</h2>
          <p>{details.contact_person}</p>
          <p className="text-zinc-500">{details.contact_phone}</p>
        </div>
      </section>

      <ul className="flex flex-col gap-1 text-sm">
        {items.map((item) => (
          <li key={item.id} className="flex justify-between">
            <span>
              {item.quantity}× {item.item_name_snapshot}
            </span>
            <span>{item.line_total_mdl} MDL</span>
          </li>
        ))}
        <li className="flex justify-between border-t border-zinc-200 pt-1 font-medium dark:border-zinc-800">
          <span>{details.quote_status === "requested" ? "Subtotal estimativ" : "Total ofertat"}</span>
          <span>
            {details.quote_status === "requested"
              ? `${order.subtotal_mdl} MDL`
              : `${details.quoted_total_mdl ?? order.total_mdl} MDL`}
          </span>
        </li>
      </ul>

      {details.restaurant_notes && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Mesaj de la restaurant: {details.restaurant_notes}
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!isTerminal && (
        <div className="flex gap-3">
          {details.quote_status === "quoted" && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={pending}
              className="rounded-full bg-primary px-6 py-3 text-sm text-white transition hover:bg-primary-dark disabled:opacity-50"
            >
              {pending ? "..." : `Confirmă oferta — ${details.quoted_total_mdl} MDL`}
            </button>
          )}
          {order.status === "pending_restaurant" && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              className="rounded-full border border-zinc-300 px-6 py-3 text-sm transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Anulează cererea
            </button>
          )}
        </div>
      )}
    </div>
  );
}
