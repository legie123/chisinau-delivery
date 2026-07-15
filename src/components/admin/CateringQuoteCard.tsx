"use client";

import { useState, useTransition } from "react";
import { declineCateringQuote, submitCateringQuote } from "@/app/(admin)/restaurant/catering/actions";
import { ORDER_STATUS_LABEL, type CateringDetails, type Order, type OrderItem } from "@/lib/types/domain";

export function CateringQuoteCard({
  order,
  details,
  items,
}: {
  order: Order;
  details: CateringDetails;
  items: OrderItem[];
}) {
  const [quote, setQuote] = useState(details.quoted_total_mdl ?? order.subtotal_mdl);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A cancelled/rejected order must not keep offering quote actions —
  // submit_catering_quote only checks quote_status, so the UI is the guard here.
  const isTerminal = order.status === "cancelled" || order.status === "rejected";

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (quote <= 0) {
      setError("Introdu o sumă validă.");
      return;
    }
    startTransition(async () => {
      const result = await submitCateringQuote(order.id, quote);
      setError(result.error);
    });
  }

  function handleDecline() {
    const reason = window.prompt("Motivul refuzului:");
    if (reason === null || !reason.trim()) return;
    startTransition(async () => {
      const result = await declineCateringQuote(order.id, reason);
      setError(result.error);
    });
  }

  const statusLabel = isTerminal
    ? ORDER_STATUS_LABEL[order.status]
    : details.quote_status === "requested"
      ? "Așteaptă ofertă"
      : details.quote_status === "quoted"
        ? "Ofertă trimisă"
        : details.quote_status === "confirmed"
          ? `Confirmată · ${ORDER_STATUS_LABEL[order.status]}`
          : "Refuzată";

  return (
    <li className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
      <div className="flex items-center justify-between">
        <p className="font-medium">{order.order_number}</p>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/80">{statusLabel}</span>
      </div>

      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <p>
          {details.event_date}
          {details.event_time ? ` · ${details.event_time.slice(0, 5)}` : ""} · {details.guest_count} invitați
        </p>
        <p className="text-white/50">{details.event_address_text}</p>
        <p>
          {details.contact_person} · {details.contact_phone}
        </p>
        {order.notes && <p className="text-white/50">Note: {order.notes}</p>}
      </div>

      <ul className="flex flex-col gap-1 text-sm">
        {items.map((item) => (
          <li key={item.id} className="flex justify-between">
            <span>
              {item.quantity}× {item.item_name_snapshot}
            </span>
            <span>{item.line_total_mdl} MDL</span>
          </li>
        ))}
        <li className="flex justify-between border-t border-white/10 pt-1 text-white/50">
          <span>Subtotal listă</span>
          <span>{order.subtotal_mdl} MDL</span>
        </li>
      </ul>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!isTerminal && details.quote_status === "requested" && (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            Ofertă finală (MDL)
            <input
              type="number"
              min={1}
              step="0.01"
              required
              value={quote}
              onChange={(e) => setQuote(Number(e.target.value))}
              className="w-32 rounded-lg bg-white/5 px-2.5 py-1.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-primary px-5 py-2 text-sm text-white transition hover:bg-primary-dark disabled:opacity-50"
          >
            {pending ? "..." : "Trimite oferta"}
          </button>
          <button
            type="button"
            onClick={handleDecline}
            disabled={pending}
            className="rounded-full border border-white/15 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-50"
          >
            Refuză
          </button>
        </form>
      )}

      {!isTerminal && details.quote_status === "quoted" && (
        <p className="text-sm text-white/50">
          Ofertă trimisă: <span className="font-medium">{details.quoted_total_mdl} MDL</span> — așteptăm
          confirmarea clientului.
        </p>
      )}
    </li>
  );
}
