"use client";

import type { AdminFleetRow } from "@/lib/types/domain";

const VEHICLE_LABEL: Record<string, string> = {
  bike: "Bicicletă",
  e_bike: "E-bike",
  scooter: "Scuter",
  car: "Mașină",
  on_foot: "Pe jos",
};

const STATUS_DOT: Record<string, string> = {
  online: "bg-emerald-400",
  on_delivery: "bg-gold",
  offline: "bg-white/25",
};

export function FleetPanel({ fleet }: { fleet: AdminFleetRow[] }) {
  const online = fleet.filter((c) => c.status === "online").length;
  const onDelivery = fleet.filter((c) => c.status === "on_delivery").length;
  const offline = fleet.filter((c) => c.status === "offline").length;
  const inactive = fleet.filter((c) => !c.is_active).length;

  return (
    <section className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 font-semibold text-emerald-400">{online} online</span>
        <span className="rounded-full bg-gold/15 px-2.5 py-1 font-semibold text-gold">{onDelivery} în livrare</span>
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-white/50">{offline} offline</span>
        {inactive > 0 && <span className="rounded-full bg-white/5 px-2.5 py-1 text-white/40">{inactive} inactivi</span>}
      </div>

      <ul className="flex flex-col divide-y divide-white/5">
        {fleet.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[c.status] ?? "bg-white/25"}`} aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{c.full_name}</p>
                <p className="text-xs text-white/40">{VEHICLE_LABEL[c.vehicle_type] ?? c.vehicle_type}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs">
              {c.active_order_number && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary">
                  {c.active_order_number}
                </span>
              )}
              {c.status !== "offline" && c.location_stale && (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-white/40">GPS vechi</span>
              )}
            </div>
          </li>
        ))}
        {fleet.length === 0 && <li className="py-4 text-center text-sm text-white/40">Niciun curier înregistrat.</li>}
      </ul>
    </section>
  );
}
