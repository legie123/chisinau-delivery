"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { acceptOrder, markReadyForPickup, rejectOrder } from "@/app/(admin)/restaurant/orders/actions";
import { SlaCountdown } from "@/components/shared/SlaCountdown";
import { ReadyTargetBadge } from "@/components/admin/ReadyTargetBadge";
import { ORDER_STATUS_LABEL, type Order, type OrderItem } from "@/lib/types/domain";

const STATUS_EMOJI: Record<string, string> = {
  pending_restaurant: "🔔",
  accepted: "👨‍🍳",
  ready_for_pickup: "🥡",
  courier_assigned: "🛵",
  picked_up: "🛵",
  en_route: "🛵",
};

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

  function handleReject() {
    if (!rejectReason.trim()) return;
    startTransition(async () => {
      const result = await rejectOrder(order.id, rejectReason.trim());
      setError(result.error);
      if (!result.error) setRejecting(false);
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
      <div className="flex w-full items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-full text-xl ${
            isNew ? "bg-[color:var(--pg-gold-0)]/20 ring-1 ring-[color:var(--pg-gold-line)]" : "bg-white/10"
          }`}
          aria-hidden
        >
          {STATUS_EMOJI[order.status] ?? "📦"}
        </span>
        <div>
          <p className="font-semibold text-white">{order.order_number}</p>
          <p className="mt-0.5 text-sm text-white/50">
            {ORDER_STATUS_LABEL[order.status]} · <span className="pg-gold-text font-semibold">{order.total_mdl} MDL</span>
          </p>
          {order.status === "pending_restaurant" && (
            <div className="mt-1.5">
              <SlaCountdown createdAt={order.created_at} slaMinutes={acceptSlaMinutes} variant="partner" />
            </div>
          )}
          {order.status === "accepted" && order.estimated_ready_at && (
            <div className="mt-1.5 inline-block rounded-full ring-1 ring-[color:var(--pg-amethyst-line)] shadow-[0_0_10px_-2px_rgba(168,85,247,0.45)]">
              <ReadyTargetBadge estimatedReadyAt={order.estimated_ready_at} />
            </div>
          )}
          {error && <p className="mt-1 text-xs text-primary">{error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {order.status === "pending_restaurant" && (
          <>
            <button
              type="button"
              onClick={handleAccept}
              disabled={pending}
              className="pg-cta rounded-full px-5 py-2.5 text-sm disabled:opacity-50"
            >
              Acceptă
            </button>
            <button
              type="button"
              onClick={() => setRejecting((v) => !v)}
              disabled={pending}
              className="rounded-full bg-white/5 px-5 py-2.5 text-sm text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
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
            className="pg-cta rounded-full px-5 py-2.5 text-sm disabled:opacity-50"
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
        <div className="mt-1 flex w-full items-center gap-2">
          <input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            aria-label="Motivul refuzului"
            placeholder="Motivul refuzului (obligatoriu)"
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
      )}
    </li>
  );
}
