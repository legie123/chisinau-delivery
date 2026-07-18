"use client";

import { useOrderRealtime } from "@/hooks/useOrderRealtime";
import { useCourierLocation } from "@/hooks/useCourierLocation";
import { useRoute } from "@/hooks/useRoute";
import { SlaCountdown } from "@/components/shared/SlaCountdown";
import { PrepCountdown } from "@/components/customer/PrepCountdown";
import { RatingForm } from "@/components/customer/RatingForm";
import { DeliveryMap, type MapPoint } from "@/components/shared/DeliveryMap";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  type DeliveryStatusEvent,
  type Order,
  type OrderItem,
  type Rating,
} from "@/lib/types/domain";

// Bolt-style 4-step progress. Maps our 7 active statuses onto customer-facing steps.
const STEPS = [
  { label: "Confirmată", emoji: "✅" },
  { label: "În pregătire", emoji: "👨‍🍳" },
  { label: "Pe drum", emoji: "🛵" },
  { label: "Livrată", emoji: "🎉" },
];

function stepIndex(status: Order["status"]): number {
  switch (status) {
    case "pending_restaurant":
      return -1; // waiting for confirmation — step 0 pulses
    case "accepted":
      return 0;
    case "ready_for_pickup":
    case "courier_assigned":
      return 1;
    case "picked_up":
    case "en_route":
      return 2;
    case "delivered":
      return 3;
    default:
      return -2; // cancelled/rejected — stepper hidden
  }
}

export function OrderTracking({
  initialOrder,
  initialEvents,
  items,
  acceptSlaMinutes,
  initialRatings,
  pickup = null,
  dropoff = null,
}: {
  initialOrder: Order;
  initialEvents: DeliveryStatusEvent[];
  items: OrderItem[];
  acceptSlaMinutes: number;
  initialRatings: Rating[];
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
}) {
  const { order, events } = useOrderRealtime(initialOrder.id, initialOrder, initialEvents);
  const tracking = order.status === "picked_up" || order.status === "en_route";
  const position = useCourierLocation(order.id, order.courier_id, tracking);

  // Real road route toward the customer: courier → dropoff once we have a live
  // GPS fix, otherwise a pickup → dropoff preview.
  const { line: routeLine, minutes } = useRoute(position ?? pickup, dropoff);
  const etaLabel =
    minutes == null
      ? undefined
      : position
        ? `Sosire ~${minutes} min`
        : `~${minutes} min de livrare`;

  const current = stepIndex(order.status);
  const isTerminalBad = order.status === "cancelled" || order.status === "rejected";

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* Status hero card with stepper */}
      <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        {isTerminalBad ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <span className="text-5xl" aria-hidden>😔</span>
            <p className="text-lg font-semibold text-white">{ORDER_STATUS_LABEL[order.status]}</p>
            {order.cancellation_reason && <p className="text-sm text-white/50">{order.cancellation_reason}</p>}
          </div>
        ) : (
          <>
            <p className="mb-1 text-center text-lg font-semibold text-white">
              {order.status === "pending_restaurant"
                ? "Așteptăm confirmarea restaurantului..."
                : ORDER_STATUS_LABEL[order.status]}
            </p>
            {order.status === "pending_restaurant" && (
              <div className="mb-4 text-center">
                <SlaCountdown createdAt={order.created_at} slaMinutes={acceptSlaMinutes} variant="customer" />
              </div>
            )}
            {order.estimated_ready_at &&
            ["accepted", "ready_for_pickup", "courier_assigned"].includes(order.status) ? (
              <div className="mb-4">
                <PrepCountdown estimatedReadyAt={order.estimated_ready_at} status={order.status} />
              </div>
            ) : (
              order.status !== "pending_restaurant" && <div className="mb-4" />
            )}
            <div className="flex items-start justify-between">
              {STEPS.map((step, i) => {
                const done = i <= current;
                const active = i === current + 1 && !done;
                return (
                  <div key={step.label} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="flex w-full items-center">
                      <div className={`h-1 flex-1 rounded ${i === 0 ? "opacity-0" : i <= current ? "bg-primary" : "bg-white/10"}`} />
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${
                          done
                            ? "bg-primary"
                            : active
                              ? "animate-pulse bg-primary/30 ring-2 ring-primary"
                              : "bg-white/10"
                        }`}
                        aria-hidden
                      >
                        {step.emoji}
                      </span>
                      <div className={`h-1 flex-1 rounded ${i === STEPS.length - 1 ? "opacity-0" : i < current ? "bg-primary" : "bg-white/10"}`} />
                    </div>
                    <span className={`text-center text-xs ${done || active ? "font-semibold text-white" : "text-white/40"}`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* WS6 — post-delivery ratings. order is live via useOrderRealtime, so this
          appears the moment delivery completes without a reload. */}
      {order.status === "delivered" && (
        <RatingForm orderId={order.id} hasCourier={!!order.courier_id} existing={initialRatings} />
      )}

      {/* Live GPS map — the courier moving toward you, with pickup + dropoff. */}
      {tracking && (position || dropoff || pickup) && (
        <DeliveryMap
          pickup={pickup}
          dropoff={dropoff}
          courier={position}
          routeLine={routeLine}
          etaLabel={etaLabel}
          heightClass="h-60"
        />
      )}

      {/* Courier live card */}
      {tracking && (
        <section className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/20 text-xl" aria-hidden>
              🛵
            </span>
            <div>
              <p className="font-semibold text-white">Curierul tău e pe drum</p>
              <p className="text-sm text-white/50">
                {position ? "Poziție live disponibilă" : "Așteptăm semnalul GPS..."}
              </p>
            </div>
          </div>
          {position && (
            <a
              href={`https://www.google.com/maps?q=${position.lat},${position.lng}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark"
            >
              Vezi pe hartă
            </a>
          )}
        </section>
      )}

      {/* Items + totals card */}
      <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Comanda ta</h2>
        <ul className="flex flex-col gap-2 text-[15px]">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between text-white/90">
              <span>
                {item.quantity}× {item.item_name_snapshot}
              </span>
              <span>{item.line_total_mdl} MDL</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-1.5 border-t border-white/10 pt-3 text-[15px]">
          <div className="flex justify-between text-white/70">
            <span>Subtotal</span>
            <span>{order.subtotal_mdl} MDL</span>
          </div>
          <div className="flex justify-between text-white/70">
            <span>Livrare</span>
            <span>{Number(order.delivery_fee_mdl) === 0 ? "Gratuită" : `${order.delivery_fee_mdl} MDL`}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-white">
            <span>Total ({PAYMENT_METHOD_LABEL[order.payment_method]})</span>
            <span>{order.total_mdl} MDL</span>
          </div>
        </div>
      </section>

      {/* Timeline card */}
      <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Istoric</h2>
        <ul className="flex flex-col gap-2.5">
          {events.map((event) => (
            <li key={event.id} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-white/90">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                {ORDER_STATUS_LABEL[event.status as Order["status"]] ?? event.status}
              </span>
              <span className="text-white/40">
                {new Date(event.created_at).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Chisinau" })}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
