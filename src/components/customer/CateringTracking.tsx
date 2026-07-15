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

  // Server Actions revalidate this route and the server component re-renders
  // with fresh props — without this sync, useState would keep the stale copy
  // and the confirm button would stay on screen after a successful confirm.
  // Adjust-during-render is React's recommended pattern for prop-driven state.
  const [prevInitialOrder, setPrevInitialOrder] = useState(initialOrder);
  if (prevInitialOrder !== initialOrder) {
    setPrevInitialOrder(initialOrder);
    setOrder(initialOrder);
  }
  const [prevInitialDetails, setPrevInitialDetails] = useState(initialDetails);
  if (prevInitialDetails !== initialDetails) {
    setPrevInitialDetails(initialDetails);
    setDetails(initialDetails);
  }

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
      const result = await confirmCateringQuote(order.id);
      setError(result.error);
    });
  }

  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  function handleCancel() {
    startTransition(async () => {
      const result = await cancelCateringOrder(order.id, cancelReason.trim());
      setError(
        result.error
          ? result.error.includes("too late")
            ? "Comanda a fost deja confirmată de restaurant — nu mai poate fi anulată."
            : "Anularea a eșuat. Încearcă din nou."
          : null,
      );
      if (!result.error) setCancelling(false);
    });
  }

  const isTerminal = order.status === "cancelled" || order.status === "rejected";
  const hasQuote =
    (details.quote_status === "quoted" || details.quote_status === "confirmed") &&
    details.quoted_total_mdl != null;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
        <p className="text-sm font-medium">
          {isTerminal ? ORDER_STATUS_LABEL[order.status] : QUOTE_LABEL[details.quote_status]}
        </p>
        {isTerminal && order.cancellation_reason && (
          <p className="mt-1 text-sm text-white/50">{order.cancellation_reason}</p>
        )}
        {details.quote_status === "confirmed" && !isTerminal && (
          <p className="mt-1 text-sm text-white/50">
            Status livrare: {ORDER_STATUS_LABEL[order.status]}
          </p>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
          <h2 className="mb-2 font-medium">Eveniment</h2>
          <p>
            {details.event_date}
            {details.event_time ? ` · ${details.event_time.slice(0, 5)}` : ""} · {details.guest_count} invitați
          </p>
          <p className="text-white/50">{details.event_address_text}</p>
        </div>
        <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
          <h2 className="mb-2 font-medium">Contact</h2>
          <p>{details.contact_person}</p>
          <p className="text-white/50">{details.contact_phone}</p>
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
        <li className="flex justify-between border-t border-white/10 pt-1 font-medium">
          <span>{hasQuote ? "Total ofertat" : "Subtotal estimativ"}</span>
          <span>{hasQuote ? `${details.quoted_total_mdl} MDL` : `${order.subtotal_mdl} MDL`}</span>
        </li>
      </ul>

      {details.restaurant_notes && (
        <p className="rounded-md bg-white/5 px-3 py-2 text-sm text-white/60">
          Mesaj de la restaurant: {details.restaurant_notes}
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

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
          {order.status === "pending_restaurant" && !cancelling && (
            <button
              type="button"
              onClick={() => setCancelling(true)}
              disabled={pending}
              className="rounded-full border border-white/15 px-6 py-3 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-50"
            >
              Anulează cererea
            </button>
          )}
        </div>
      )}

      {cancelling && order.status === "pending_restaurant" && (
        <div className="flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
          <input
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Motivul anulării (opțional)"
            className="rounded-xl bg-white/5 px-3 py-2 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Confirmă anularea
            </button>
            <button
              type="button"
              onClick={() => setCancelling(false)}
              className="rounded-full px-5 py-2 text-sm text-white/60 underline underline-offset-4"
            >
              Renunță
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
