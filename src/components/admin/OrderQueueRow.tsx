"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { acceptOrder, extendPrepTime, markReadyForPickup, rejectOrder, setPrepTimeEstimate } from "@/app/(admin)/restaurant/orders/actions";
import { pickupCode } from "@/lib/kitchen/pickupCode";
import { SlaCountdown } from "@/components/shared/SlaCountdown";
import { ReadyTargetBadge } from "@/components/admin/ReadyTargetBadge";
import { ORDER_STATUS_LABEL, type Order, type OrderItem } from "@/lib/types/domain";
import { formatScheduledFor, isScheduledStillAhead } from "@/lib/orders/scheduled";

const STATUS_EMOJI: Record<string, string> = {
  pending_restaurant: "🔔",
  accepted: "👨‍🍳",
  ready_for_pickup: "🥡",
  courier_assigned: "🛵",
  picked_up: "🛵",
  en_route: "🛵",
};

const REJECT_REASONS = [
  "Produs epuizat",
  "Bucătăria e supraîncărcată",
  "Închidem în curând",
  "Problemă tehnică",
];

export function OrderQueueRow({
  order,
  items = [],
  acceptSlaMinutes,
}: {
  order: Order;
  items?: OrderItem[];
  acceptSlaMinutes: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAccept() {
    startTransition(async () => {
      const result = await acceptOrder(order.id);
      setError(result.error);
    });
  }

  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Order 4 (Glovo model) — prep-time override, editable ONLY pre-accept (the
  // RPC itself also enforces this — the field just disappears once accepted).
  const [prepMinutes, setPrepMinutes] = useState(String(order.prep_time_override_minutes ?? ""));
  function handleSetPrepTime() {
    const minutes = Number(prepMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    startTransition(async () => {
      const result = await setPrepTimeEstimate(order.id, Math.round(minutes));
      setError(result.error);
    });
  }

  function handleReject() {
    if (!rejectReason.trim()) return;
    startTransition(async () => {
      const result = await rejectOrder(order.id, rejectReason.trim());
      setError(result.error);
      if (!result.error) setRejecting(false);
    });
  }

  function handleExtend(minutes: 5 | 10 | 15) {
    startTransition(async () => {
      const result = await extendPrepTime(order.id, minutes);
      setError(result.error);
    });
  }

  function handleReady() {
    startTransition(async () => {
      const result = await markReadyForPickup(order.id);
      setError(result.error);
    });
  }

  const isNew = order.status === "pending_restaurant";

  return (
    <li
      className={`pg-arrival flex flex-col gap-3 rounded-2xl p-5 ${isNew ? "pg-new" : "pg-card"}`}
    >
      {/* La 390×844 rândul ăsta măsura 502 px: coloana de text nu avea voie să
          se strângă (`min-width: auto`, implicitul oricărui element de flex),
          blocul de acțiuni era `shrink-0`, deci nimeni nu ceda și pagina se
          trăgea lateral cu 112 px — „Refuză" ieșea ÎNTREG din ecran. Acum
          coloana are dreptul să se strângă (`min-w-0`, pe ambele niveluri) și
          rândul are dreptul să se rupă: la telefon butoanele coboară pe
          propriul rând, la lățime de tabletă în sus se întorc lângă text, ca
          înainte. */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl ${
            isNew ? "bg-[color:var(--pg-gold-0)]/20 ring-1 ring-[color:var(--pg-gold-line)]" : "bg-white/10"
          }`}
          aria-hidden
        >
          {STATUS_EMOJI[order.status] ?? "📦"}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-white">{order.order_number}</p>
          <p className="mt-0.5 text-sm text-white/50">
            {ORDER_STATUS_LABEL[order.status]} · <span className="pg-gold-text font-semibold">{order.total_mdl} MDL</span>
          </p>
          {order.requested_for && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-400/10 px-2 py-0.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-400/30">
              🕒 Programată: {formatScheduledFor(order.requested_for)}
            </p>
          )}
          {order.status === "pending_restaurant" && !isScheduledStillAhead(order.requested_for) && (
            <div className="mt-1.5">
              <SlaCountdown createdAt={order.created_at} slaMinutes={acceptSlaMinutes} variant="partner" />
            </div>
          )}
          {order.status === "pending_restaurant" && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <label htmlFor={`prep-${order.id}`} className="text-xs text-white/45">
                ⏱ Timp de pregătire (min):
              </label>
              <input
                id={`prep-${order.id}`}
                type="number"
                min={1}
                value={prepMinutes}
                onChange={(e) => setPrepMinutes(e.target.value)}
                className="w-16 rounded-lg bg-white/5 px-2 py-1 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-gold/60"
              />
              <button
                type="button"
                onClick={handleSetPrepTime}
                disabled={pending}
                className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
              >
                Setează
              </button>
            </div>
          )}
          {order.status === "accepted" && order.estimated_ready_at && (
            <div className="mt-1.5 inline-block rounded-full ring-1 ring-[color:var(--pg-amethyst-line)] shadow-[0_0_10px_-2px_rgba(168,85,247,0.45)]">
              <ReadyTargetBadge estimatedReadyAt={order.estimated_ready_at} />
            </div>
          )}
          {order.status === "accepted" && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-white/45">Mai am nevoie de:</span>
              {([5, 10, 15] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleExtend(m)}
                  disabled={pending}
                  className="min-h-11 rounded-full bg-white/5 px-3 text-xs text-white/75 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
                >
                  +{m} min
                </button>
              ))}
            </div>
          )}
          {(order.status === "ready_for_pickup" || order.status === "courier_assigned") && pickupCode(order.order_number) && (
            <p className="mt-1.5 inline-flex items-baseline gap-2 rounded-xl bg-white/10 px-3 py-1.5 ring-1 ring-white/15">
              <span className="text-xs text-white/60">Cod ridicare</span>
              <span className="font-mono text-2xl font-bold tracking-widest text-white">{pickupCode(order.order_number)}</span>
              <span className="text-xs text-white/45">cere-l curierului înainte să dai punga</span>
            </p>
          )}
          {error && <p className="mt-1 text-xs text-primary">{error}</p>}
        </div>
      </div>
      {/* `w-full sm:w-auto` = pe telefon rândul propriu, deci butoanele stau în
          treimea de jos a cardului, sub degetul mare (regula 2 a rubricii), în
          loc să fie împinse în afara ferestrei. De la sm în sus, exact ce era. */}
      <div className="flex w-full shrink-0 gap-2 sm:w-auto">
        {order.status === "pending_restaurant" && (
          <>
            <button
              type="button"
              onClick={handleAccept}
              disabled={pending}
              className="pg-cta flex-1 rounded-full px-5 py-2.5 text-sm disabled:opacity-50 sm:flex-none"
            >
              Acceptă
            </button>
            <button
              type="button"
              onClick={() => setRejecting((v) => !v)}
              disabled={pending}
              className="flex-1 rounded-full bg-white/5 px-5 py-2.5 text-sm text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50 sm:flex-none"
            >
              Refuză
            </button>
          </>
        )}
        {order.status === "accepted" && (
          <button
            type="button"
            onClick={handleReady}
            disabled={pending}
            className="pg-cta flex-1 rounded-full px-5 py-2.5 text-sm disabled:opacity-50 sm:flex-none"
          >
            <span className="pg-shimmer pointer-events-none absolute inset-0 rounded-full" aria-hidden />
            <span className="relative">🥡 Gata de ridicare</span>
          </button>
        )}
      </div>
      </div>

      {/* What the kitchen must cook: line items + their modifiers + per-item
          notes. Without this the row showed only a total — nothing to prepare. */}
      {items.length > 0 && (
        <ul className="pg-divider-gold flex flex-col gap-1.5 border-t pt-3 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-white/90">
                  <span className="font-semibold text-white">{item.quantity}×</span> {item.item_name_snapshot}
                </span>
                <span className="shrink-0 text-white/45">{item.line_total_mdl} MDL</span>
              </div>
              {item.selected_options?.length > 0 && (
                <p className="pl-5 text-xs text-white/50">
                  {item.selected_options.map((opt) => opt.name).join(" · ")}
                </p>
              )}
              {item.notes && <p className="pl-5 text-xs italic text-gold/80">„{item.notes}”</p>}
            </li>
          ))}
        </ul>
      )}

      <Link
        href={`/restaurant/orders/${order.id}`}
        className="text-xs font-medium text-white/45 transition hover:text-gold hover:underline"
      >
        Detalii comandă →
      </Link>

      {rejecting && order.status === "pending_restaurant" && (
        <div className="mt-1 flex w-full flex-col gap-2">
        {/* Motive presetate: un tap pe tabletă, cu mâinile ude, în loc de tastat.
            Textul ajunge neschimbat la client (orders.cancellation_reason). */}
        <div className="flex flex-wrap gap-1.5">
          {REJECT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRejectReason(r)}
              aria-pressed={rejectReason === r}
              className={`rounded-full px-3 py-2 text-xs ring-1 transition ${
                rejectReason === r
                  ? "bg-primary-dark text-white ring-primary/60"
                  : "bg-white/5 text-white/70 ring-white/10 hover:bg-white/10"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex w-full items-center gap-2">
          <input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            aria-label="Motivul refuzului"
            placeholder="Alege un motiv sau scrie altul"
            className="flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
          />
          <button
            type="button"
            onClick={handleReject}
            disabled={pending || !rejectReason.trim()}
            className="rounded-full bg-primary-dark px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Trimite refuzul
          </button>
        </div>
        </div>
      )}
    </li>
  );
}
