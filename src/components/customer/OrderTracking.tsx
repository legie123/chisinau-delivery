"use client";

import { useOrderRealtime } from "@/hooks/useOrderRealtime";
import { useCourierLocation } from "@/hooks/useCourierLocation";
import { useRoute } from "@/hooks/useRoute";
import { SlaCountdown } from "@/components/shared/SlaCountdown";
import { PrepCountdown } from "@/components/customer/PrepCountdown";
import { RatingForm } from "@/components/customer/RatingForm";
import { CancelOrderButton } from "@/components/customer/CancelOrderButton";
import { DeliveryMap, type MapPoint } from "@/components/shared/DeliveryMap";
import {
  ORDER_STATUS_LABEL,
  type DeliveryStatusEvent,
  type Order,
  type OrderItem,
  type Rating,
} from "@/lib/types/domain";
import { formatScheduledFor } from "@/lib/orders/scheduled";
import { paymentPresence } from "@/lib/orders/payment";
import { supportPhone } from "@chisinau/shared-domain";

// From NEXT_PUBLIC_SUPPORT_PHONE; null until a real number is configured (never the old placeholder).
const SUPPORT_PHONE = supportPhone(process.env.NEXT_PUBLIC_SUPPORT_PHONE);

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
  courierFirstName = null,
  courierPhone = null,
}: {
  initialOrder: Order;
  initialEvents: DeliveryStatusEvent[];
  items: OrderItem[];
  acceptSlaMinutes: number;
  initialRatings: Rating[];
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
  courierFirstName?: string | null;
  courierPhone?: string | null;
}) {
  const { order, events } = useOrderRealtime(initialOrder.id, initialOrder, initialEvents);
  const tracking = order.status === "picked_up" || order.status === "en_route";
  // Courier is assigned and delivery is still active (not yet delivered) — this is
  // broader than `tracking` (which gates the live GPS map/position) so the name +
  // phone show as soon as a courier is on the order, before pickup.
  const courierActive =
    !!order.courier_id &&
    (order.status === "courier_assigned" || order.status === "picked_up" || order.status === "en_route");
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

  // Ce s-a întâmplat cu banii, citit din `payment_status` în loc de dedus din
  // metodă. Eticheta veche (`PAYMENT_METHOD_LABEL`) spunea „plătit online" și
  // pentru o plată eșuată, și pentru una returnată.
  const pay = paymentPresence({
    method: order.payment_method,
    status: order.payment_status,
    orderStatus: order.status,
    amountMdl: order.total_mdl,
  });

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
            {/* aria-live so screen readers announce each realtime status change (#50) */}
            <p role="status" aria-live="polite" className="mb-1 text-center font-serif text-xl font-bold text-white">
              {order.status === "pending_restaurant"
                ? "Așteptăm confirmarea restaurantului..."
                : ORDER_STATUS_LABEL[order.status]}
            </p>
            {order.requested_for && order.status !== "delivered" && (
              <p className="mb-2 text-center">
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/10 px-3 py-1 text-sm font-semibold text-sky-300 ring-1 ring-sky-400/30">
                  🕒 Comandă programată pentru {formatScheduledFor(order.requested_for)}
                </span>
              </p>
            )}
            {order.status === "pending_restaurant" && (
              <div className="mb-4 text-center">
                <SlaCountdown createdAt={order.created_at} slaMinutes={acceptSlaMinutes} variant="customer" />
                {/* #37 — cancellation is allowed only pre-confirmation; offer it here. */}
                <CancelOrderButton orderId={order.id} />
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
                  <div
                    key={step.label}
                    className="flex flex-1 flex-col items-center gap-1.5"
                    aria-current={active ? "step" : undefined}
                  >
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

      {/* Arrival payoff — the premium "delivered" moment (Godmode tracking language). */}
      {order.status === "delivered" && (
        <section className="flex flex-col items-center gap-2 rounded-2xl border border-gold/40 bg-gradient-to-b from-[#2a1f0a] to-[#181206] p-6 text-center">
          <span className="text-4xl" aria-hidden>🎉</span>
          <p className="font-serif text-xl font-bold text-gold">Livrată cu succes</p>
          <p className="text-sm text-white/60">Mulțumim că ai comandat cu Dragons Delivery</p>
        </section>
      )}

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
      {courierActive && (
        <section className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/20 text-xl" aria-hidden>
              🛵
            </span>
            <div>
              <p className="font-semibold text-white">
                {courierFirstName ? `${courierFirstName} e pe drum` : "Curierul tău e pe drum"}
              </p>
              <p className="text-sm text-white/50">
                {tracking ? (position ? "Poziție live disponibilă" : "Așteptăm semnalul GPS...") : "Curier alocat comenzii tale"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {courierPhone && (
              <a
                href={`tel:${courierPhone}`}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-dark text-lg transition hover:bg-primary-darker"
                aria-label={courierFirstName ? `Sună-l pe ${courierFirstName}` : "Sună curierul"}
              >
                📞
              </a>
            )}
            {tracking && position && (
              <a
                href={`https://www.google.com/maps?q=${position.lat},${position.lng}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-primary-dark px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-darker"
              >
                Vezi pe hartă
              </a>
            )}
          </div>
        </section>
      )}

      {/* Items + totals card */}
      <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Comanda ta</h2>
        <ul className="flex flex-col gap-2 text-[15px]">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 text-white/90">
              <span className="min-w-0">
                {item.quantity}× {item.item_name_snapshot}
                {item.selected_options?.length > 0 && (
                  <span className="block text-xs text-white/40">
                    {item.selected_options.map((o) => o.name).join(", ")}
                  </span>
                )}
              </span>
              <span className="shrink-0">{item.line_total_mdl} MDL</span>
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
          {/* Tip shown as its own line instead of being silently folded into the total (#36) */}
          {Number(order.tip_mdl) > 0 && (
            <div className="flex justify-between text-white/70">
              <span>Bacșiș curier</span>
              <span>{order.tip_mdl} MDL</span>
            </div>
          )}
          {/* Starea plății e un calificativ, nu titlul rândului: la 390px
              „Total (online, bani returnați)" împingea suma pe două rânduri —
              adică exact cifra pe care omul a deschis pagina s-o vadă. Suma
              rămâne pe o linie, eticheta se rupe dacă trebuie. */}
          <div className="flex items-baseline justify-between gap-3 text-lg font-bold text-white">
            <span className="min-w-0">
              Total{" "}
              <span className="text-sm font-medium text-white/60">({pay.totalLabel})</span>
            </span>
            <span className="shrink-0 whitespace-nowrap">{order.total_mdl} MDL</span>
          </div>
          {/* Corectarea stă lipită de cifra pe care o corectează: o comandă
              returnată nu poate arăta un total simplu, iar una cu plata căzută
              nu poate arăta niciun fel de „plătit". */}
          {pay.notice && (
            <div
              role="status"
              className={`mt-2 flex flex-col gap-0.5 rounded-xl px-3 py-2 text-sm ring-1 ${
                pay.notice.tone === "good"
                  ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                  : "bg-amber-400/10 text-amber-200 ring-amber-400/30"
              }`}
            >
              <span className="font-semibold">{pay.notice.label}</span>
              {pay.notice.detail && <span className="text-white/70">{pay.notice.detail}</span>}
            </div>
          )}
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

      {/* Minimal dispute channel — discreet, mail/phone only (no in-app form). */}
      <div className="flex items-center justify-center gap-4 pt-1 text-xs text-white/30">
        <a
          href={`mailto:contact@dragonsdelivery.md?subject=${encodeURIComponent(`Comanda ${order.order_number}`)}`}
          className="underline decoration-white/20 underline-offset-2 transition hover:text-white/60"
        >
          Raportează o problemă
        </a>
        {SUPPORT_PHONE && (
          <>
            <span aria-hidden>·</span>
            <a href={SUPPORT_PHONE.tel} className="underline decoration-white/20 underline-offset-2 transition hover:text-white/60">
              Sună suportul
            </a>
          </>
        )}
      </div>
    </div>
  );
}
