"use client";

import type { Order, OrderItem } from "@/lib/types/domain";

const fmt = new Intl.DateTimeFormat("ro-RO", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Chisinau" });

// Print button + the 58 mm ticket it prints. The ticket is display:none on screen
// (premium.css .kitchen-ticket) and the only visible thing on paper.
export function KitchenTicket({
  order,
  items,
  paymentLabel,
  scheduledLabel,
}: {
  order: Pick<Order, "order_number" | "created_at" | "total_mdl" | "notes">;
  items: OrderItem[];
  paymentLabel: string;
  scheduledLabel: string | null;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => window.print()}
        className="min-h-11 rounded-full bg-white/5 px-4 text-sm text-white/75 ring-1 ring-white/10 transition hover:bg-white/10"
      >
        🖨 Tipărește bonul
      </button>
      <div className="kitchen-ticket" aria-hidden>
        <strong style={{ fontSize: 14 }}>{order.order_number}</strong>
        <div>{fmt.format(new Date(order.created_at))}</div>
        {scheduledLabel && <div>PROGRAMATĂ: {scheduledLabel}</div>}
        <hr />
        {items.map((item) => (
          <div key={item.id} style={{ marginBottom: 3 }}>
            <div>
              <strong>{item.quantity}×</strong> {item.item_name_snapshot}
            </div>
            {item.selected_options?.map((opt, i) => <div key={i}>&nbsp;&nbsp;+ {opt.name}</div>)}
            {item.notes && <div>&nbsp;&nbsp;„{item.notes}”</div>}
          </div>
        ))}
        {order.notes && (
          <>
            <hr />
            <div>Note client: {order.notes}</div>
          </>
        )}
        <hr />
        <div>
          {paymentLabel} · <strong>{order.total_mdl} MDL</strong>
        </div>
      </div>
    </>
  );
}
