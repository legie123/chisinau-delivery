"use client";

import { useState, useTransition } from "react";
import { acceptOrder, markReadyForPickup, rejectOrder } from "@/app/(admin)/restaurant/orders/actions";
import { SlaCountdown } from "@/components/shared/SlaCountdown";
import { ReadyTargetBadge } from "@/components/admin/ReadyTargetBadge";
import { ORDER_STATUS_LABEL, type Order } from "@/lib/types/domain";

const STATUS_EMOJI: Record<string, string> = {
  pending_restaurant: "🔔",
  accepted: "👨‍🍳",
  ready_for_pickup: "🥡",
  courier_assigned: "🛵",
  picked_up: "🛵",
  en_route: "🛵",
};

export function OrderQueueRow({ order, acceptSlaMinutes }: { order: Order; acceptSlaMinutes: number }) {
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
      className={`flex flex-col gap-3 rounded-2xl p-5 ring-1 ${
        isNew ? "bg-primary/10 ring-primary/40" : "bg-white/[0.04] ring-white/[0.06]"
      }`}
    >
      <div className="flex w-full items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-full text-xl ${
            isNew ? "animate-pulse bg-primary/20" : "bg-white/10"
          }`}
          aria-hidden
        >
          {STATUS_EMOJI[order.status] ?? "📦"}
        </span>
        <div>
          <p className="font-semibold text-white">{order.order_number}</p>
          <p className="mt-0.5 text-sm text-white/50">
            {ORDER_STATUS_LABEL[order.status]} · <span className="font-semibold text-white/80">{order.total_mdl} MDL</span>
          </p>
          {order.status === "pending_restaurant" && (
            <div className="mt-1.5">
              <SlaCountdown createdAt={order.created_at} slaMinutes={acceptSlaMinutes} variant="partner" />
            </div>
          )}
          {order.status === "accepted" && order.estimated_ready_at && (
            <div className="mt-1.5">
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
              className="rounded-full bg-primary-dark px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:opacity-50"
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
            className="rounded-full bg-primary-dark px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:opacity-50"
          >
            🥡 Gata de ridicare
          </button>
        )}
      </div>
      </div>
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
