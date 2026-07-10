"use client";

import { useOrderRealtime } from "@/hooks/useOrderRealtime";
import { useCourierLocation } from "@/hooks/useCourierLocation";
import { ORDER_STATUS_LABEL, type DeliveryStatusEvent, type Order, type OrderItem } from "@/lib/types/domain";

export function OrderTracking({
  initialOrder,
  initialEvents,
  items,
}: {
  initialOrder: Order;
  initialEvents: DeliveryStatusEvent[];
  items: OrderItem[];
}) {
  const { order, events } = useOrderRealtime(initialOrder.id, initialOrder, initialEvents);
  const tracking = order.status === "picked_up" || order.status === "en_route";
  const position = useCourierLocation(order.id, order.courier_id, tracking);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        Status: <span className="font-medium">{ORDER_STATUS_LABEL[order.status]}</span>
        {(order.status === "cancelled" || order.status === "rejected") && order.cancellation_reason && (
          <span className="text-zinc-500"> — {order.cancellation_reason}</span>
        )}
      </p>

      {tracking && (
        <section className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <h2 className="mb-1 font-medium">Curierul tău e pe drum</h2>
          {position ? (
            <a
              href={`https://www.google.com/maps?q=${position.lat},${position.lng}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              Vezi poziția live pe hartă ({position.lat.toFixed(4)}, {position.lng.toFixed(4)})
            </a>
          ) : (
            <p className="text-zinc-500">Așteptăm semnalul GPS al curierului...</p>
          )}
        </section>
      )}

      <ul className="flex flex-col gap-1 text-sm">
        {items.map((item) => (
          <li key={item.id} className="flex justify-between">
            <span>
              {item.quantity}× {item.item_name_snapshot}
            </span>
            <span>{item.line_total_mdl} MDL</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1 border-t border-zinc-200 pt-2 text-sm dark:border-zinc-800">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{order.subtotal_mdl} MDL</span>
        </div>
        <div className="flex justify-between">
          <span>Livrare</span>
          <span>{order.delivery_fee_mdl} MDL</span>
        </div>
        <div className="flex justify-between font-medium">
          <span>Total</span>
          <span>{order.total_mdl} MDL</span>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-zinc-500">Istoric</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {events.map((event) => (
            <li key={event.id} className="flex justify-between">
              <span>{ORDER_STATUS_LABEL[event.status as Order["status"]] ?? event.status}</span>
              <span className="text-zinc-500">{new Date(event.created_at).toLocaleTimeString("ro-RO")}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
