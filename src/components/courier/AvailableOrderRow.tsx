"use client";

import { useState, useTransition } from "react";
import { acceptDelivery } from "@/app/(courier)/deliveries/actions";
import { markRideAccepted } from "@/components/courier/RideAcceptedFocus";
import { quotedNetMdl } from "@/app/(courier)/_lib/earnings";
import type { Order } from "@/lib/types/domain";

export function AvailableOrderRow({
  order,
  disabled,
  commissionPct,
}: {
  order: Order;
  disabled?: boolean;
  // Comisionul viu (`current_pricing_config`), citit o dată pe server și
  // coborât ca prop — nu o constantă, ca banda de pe `/earnings` și cifra de
  // aici să nu poată diverge (defectul DispatchCourierAudit #2, altă suprafață).
  commissionPct: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAccept() {
    if (disabled) return;
    startTransition(async () => {
      const result = await acceptDelivery(order.id);
      setError(result.error);
      // Preluarea din listă nu navighează nicăieri — comanda apare sub
      // „Livrarea ta activă" pe ecranul curent. Fără momentul ăsta, singura
      // confirmare a unei curse luate era o listă care se rearanjează.
      if (!result.error) markRideAccepted();
    });
  }

  return (
    <li className="flex items-center justify-between gap-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
      <div className="flex items-center gap-4">
        {/* Pastila pictogramei nu e o sumă — auriul rămâne pe „Câștig". */}
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-xl" aria-hidden>
          📦
        </span>
        <div>
          <p className="font-semibold text-white">{order.order_number}</p>
          <p className="mt-0.5 text-sm text-white/50">
            De încasat: <span className="font-semibold text-white/80">{order.total_mdl} MDL</span>
          </p>
          <p className="text-sm font-bold text-gold">
            {/* Order 2 — courier_fee_quoted_mdl is a FLOOR: "tarif minim", never
                "minim garantat" (the final at delivery can only be higher).
                R8 — cifra e NETUL (`quotedNetMdl`), fiindcă net e ce i se
                decontează; brutul de dinainte era cu 15% peste plata reală. */}
            Câștig net: {quotedNetMdl(order, commissionPct)} MDL
            {Number(order.tip_mdl) > 0 && (
              <span className="ml-1.5 font-semibold text-emerald-400">+{order.tip_mdl} bacșiș</span>
            )}
          </p>
          {/* O singură propoziție, fără separator: prima variantă avea „net …
              · tarif minim …", care la 390px se rupea taman la punct și lăsa
              rândul următor începând cu „·" orfan — exact defectul prins în
              V7 pe cardurile clientului, reintrodus de mine și văzut în
              captură înainte de commit. Fără separator, orice punct de rupere
              e sigur. */}
          {/* alb/40 dădea 3,79:1 măsurat pe pixeli peste fundalul de sector —
              sub pragul §8. Era sub prag și înainte, cu textul vechi; acum
              rândul poartă comisionul, adică chiar termenul plății, deci nu
              putea rămâne cel mai slab text de pe ecran. Aceeași treaptă ca
              reparația din V11. */}
          <p className="text-xs text-white/60">
            tarif minim după comisionul de {commissionPct}% — poate crește cu distanța reală
          </p>
          {error && <p className="mt-1 text-xs text-primary">{error}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={handleAccept}
        disabled={pending || disabled}
        title={disabled ? "Finalizează livrarea curentă mai întâi." : undefined}
        className="rounded-full bg-primary-dark px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:opacity-50"
      >
        {pending ? "..." : "Acceptă"}
      </button>
    </li>
  );
}
