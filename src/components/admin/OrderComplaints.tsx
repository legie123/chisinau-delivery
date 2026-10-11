"use client";

import { useState, useTransition } from "react";
import { addAdjustmentAction, openComplaintAction, resolveComplaintAction } from "@/app/(admin)/platform/orders/[id]/actions";

export interface PayoutAdjustment {
  id: string;
  complaint_id: string | null;
  recipient_type: "restaurant" | "courier";
  amount_mdl: number;
  reason: string;
  payout_id: string | null;
}

export interface OrderComplaint {
  id: string;
  kind: string;
  note: string;
  status: "open" | "resolved";
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

export const COMPLAINT_KIND_LABEL: Record<string, string> = {
  missing_item: "Produs lipsă",
  wrong_item: "Produs greșit",
  late: "Întârziere",
  quality: "Calitate",
  courier: "Curier",
  other: "Altceva",
};

const fmt = new Intl.DateTimeFormat("ro-RO", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Chisinau" });
const field =
  "rounded-lg bg-white/5 px-2 py-1.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60";

// Pilot support log: ops write down a complaint received by phone and how it was settled.
// One open complaint per order (enforced in the DB); no money moves from here.
export function OrderComplaints({
  orderId,
  complaints,
  adjustments,
  hasCourier,
}: {
  orderId: string;
  complaints: OrderComplaint[];
  adjustments: PayoutAdjustment[];
  hasCourier: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("missing_item");
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [payee, setPayee] = useState<"restaurant" | "courier">("restaurant");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const open = complaints.find((c) => c.status === "open");

  function run(fn: () => Promise<{ error: string | null }>, reset: () => void) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else reset();
    });
  }

  return (
    <div className="space-y-3">
      {complaints.length === 0 && <p className="text-sm text-white/50">Nicio reclamație pe această comandă.</p>}
      {complaints.map((c) => (
        <div key={c.id} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/80">{COMPLAINT_KIND_LABEL[c.kind] ?? c.kind}</span>
            <span className={c.status === "open" ? "text-gold" : "text-emerald-400"}>
              {c.status === "open" ? "Deschisă" : "Rezolvată"}
            </span>
            <span className="text-white/40">{fmt.format(new Date(c.created_at))}</span>
          </div>
          <p className="text-sm text-white/80">{c.note}</p>
          {c.resolution && (
            <p className="mt-1 text-sm text-white/60">
              Rezolvare{c.resolved_at ? ` (${fmt.format(new Date(c.resolved_at))})` : ""}: {c.resolution}
            </p>
          )}
          {adjustments
            .filter((a) => a.complaint_id === c.id)
            .map((a) => (
              <p key={a.id} className="mt-1 text-sm text-white/70">
                Ajustare {a.recipient_type === "restaurant" ? "restaurant" : "curier"}:{" "}
                <span className={Number(a.amount_mdl) < 0 ? "text-red-300" : "text-gold"}>
                  {Number(a.amount_mdl) > 0 ? "+" : "−"}
                  {Math.abs(Number(a.amount_mdl))} MDL
                </span>{" "}
                — {a.reason} · {a.payout_id ? "inclusă într-o plată" : "intră în următoarea plată"}
              </p>
            ))}
        </div>
      ))}

      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={payee}
            onChange={(e) => setPayee(e.target.value as "restaurant" | "courier")}
            aria-label="Beneficiarul ajustării"
            className={field}
          >
            <option value="restaurant">Restaurant</option>
            {hasCourier && <option value="courier">Curier</option>}
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            aria-label="Suma ajustării în MDL"
            placeholder="MDL (minus = reținere)"
            className={`${field} w-40`}
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Motivul ajustării"
            placeholder="Motiv"
            className={`${field} min-w-48 flex-1`}
          />
          <button
            type="button"
            disabled={pending || !amount || reason.trim().length < 3}
            onClick={() =>
              run(
                () => addAdjustmentAction(orderId, open.id, payee, Number(amount.replace(",", ".")), reason),
                () => {
                  setAmount("");
                  setReason("");
                },
              )
            }
            className="rounded-xl bg-white/10 px-3 py-1.5 text-sm font-semibold text-white ring-1 ring-white/15 disabled:opacity-40"
          >
            Adaugă ajustare la plată
          </button>
        </div>
      )}

      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            aria-label="Cum a fost rezolvată"
            placeholder="Cum a fost rezolvată (obligatoriu)"
            className={`${field} min-w-64 flex-1`}
          />
          <button
            type="button"
            disabled={pending || resolution.trim().length < 3}
            onClick={() => run(() => resolveComplaintAction(orderId, open.id, resolution), () => setResolution(""))}
            className="rounded-xl bg-emerald-500/20 px-3 py-1.5 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/30 disabled:opacity-40"
          >
            Marchează rezolvată
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipul reclamației" className={field}>
            {Object.entries(COMPLAINT_KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Ce s-a întâmplat"
            placeholder="Ce s-a întâmplat (obligatoriu)"
            className={`${field} min-w-64 flex-1`}
          />
          <button
            type="button"
            disabled={pending || note.trim().length < 3}
            onClick={() => run(() => openComplaintAction(orderId, kind, note), () => setNote(""))}
            className="rounded-xl bg-gold px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-40"
          >
            Înregistrează reclamația
          </button>
        </div>
      )}
      {error && <p className="text-sm text-primary">{error}</p>}
    </div>
  );
}
