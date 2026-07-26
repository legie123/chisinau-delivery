"use client";

import { useState, useTransition } from "react";
import { declineCateringQuote, markCateringReady, submitCateringQuote } from "@/app/(admin)/restaurant/catering/actions";
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

  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  function handleDecline() {
    if (!declineReason.trim()) return;
    startTransition(async () => {
      const result = await declineCateringQuote(order.id, declineReason.trim());
      setError(result.error);
      if (!result.error) setDeclining(false);
    });
  }

  function handleReady() {
    startTransition(async () => {
      const result = await markCateringReady(order.id);
      setError(result.error);
    });
  }

  // Confirmed quote → the order joins the standard pipeline at 'accepted'. The
  // kitchen prepares it, then marks it ready so dispatch offers go out.
  const canMarkReady = details.quote_status === "confirmed" && order.status === "accepted";

  // The partner can send OR correct the quote until the customer confirms it — a
  // mis-typed price ('1' instead of '1000') must be fixable, not a locked loss.
  const canQuote = !isTerminal && (details.quote_status === "requested" || details.quote_status === "quoted");

  const statusLabel = isTerminal
    ? ORDER_STATUS_LABEL[order.status]
    : details.quote_status === "requested"
      ? "Așteaptă ofertă"
      : details.quote_status === "quoted"
        ? "Ofertă trimisă"
        : details.quote_status === "confirmed"
          ? `Confirmată · ${ORDER_STATUS_LABEL[order.status]}`
          : "Refuzată";

  const statusPillClassName = isTerminal
    ? "rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/50"
    : details.quote_status === "quoted"
      ? "rounded-full bg-[color:var(--pg-amethyst-0)]/15 px-2 py-0.5 text-xs font-medium pg-amethyst-glow ring-1 ring-[color:var(--pg-amethyst-line)]"
      : details.quote_status === "confirmed"
        ? "rounded-full bg-[color:var(--pg-gold-0)]/15 px-2 py-0.5 text-xs font-semibold pg-gold-text ring-1 ring-[color:var(--pg-gold-line)]"
        : "rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/80";

  return (
    <li className="pg-card pg-arrival flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">{order.order_number}</p>
        <span className={statusPillClassName}>{statusLabel}</span>
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
        <li className="pg-divider-gold flex justify-between border-t pt-1 text-white/50">
          <span>Subtotal listă</span>
          <span>{order.subtotal_mdl} MDL</span>
        </li>
      </ul>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {canQuote && (
        <>
          {details.quote_status === "quoted" && (
            <p className="text-sm text-white/50">
              Ofertă curentă: <span className="pg-gold-text font-medium">{details.quoted_total_mdl} MDL</span> — o poți
              corecta până confirmă clientul.
            </p>
          )}
          <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              {details.quote_status === "quoted" ? "Corectează oferta (MDL)" : "Ofertă finală (MDL)"}
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
              className="pg-cta rounded-full px-5 py-2 text-sm disabled:opacity-50"
            >
              {pending ? "..." : details.quote_status === "quoted" ? "Actualizează oferta" : "Trimite oferta"}
            </button>
            <button
              type="button"
              onClick={() => setDeclining((v) => !v)}
              disabled={pending}
              className="rounded-full border border-white/15 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-50"
            >
              Refuză
            </button>
          </form>
          {declining && (
            <div className="flex items-center gap-2">
              <input
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="Motivul refuzului (obligatoriu)"
                className="flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
              />
              <button
                type="button"
                onClick={handleDecline}
                disabled={pending || !declineReason.trim()}
                className="rounded-full bg-primary-dark px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                Trimite refuzul
              </button>
            </div>
          )}
        </>
      )}

      {canMarkReady && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-white/50">
            Confirmată la <span className="pg-gold-text font-medium">{details.quoted_total_mdl} MDL</span> — pregătește
            comanda, apoi marcheaz-o gata.
          </p>
          <button
            type="button"
            onClick={handleReady}
            disabled={pending}
            className="pg-cta pg-shimmer shrink-0 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {pending ? "..." : "🥡 Marchează gata"}
          </button>
        </div>
      )}

      {!isTerminal && details.quote_status === "confirmed" && order.status !== "accepted" && (
        <p className="text-sm text-white/50">
          În livrare · <span className="font-medium text-white/80">{ORDER_STATUS_LABEL[order.status]}</span>
        </p>
      )}
    </li>
  );
}
