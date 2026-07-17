"use client";

import type { AdminFleetRow, AdminOrderBoardRow } from "@/lib/types/domain";

// Zero-dependency inline SVG map of Chișinău. Fixed bbox + linear projection —
// good enough to see where the fleet and in-flight deliveries are clustered.
// Leaflet/MapLibre is a later drop-in swap inside this one component; restaurant
// pins arrive with WS3 (restaurants have no coordinates yet).
const BBOX = { latMin: 46.93, latMax: 47.09, lngMin: 28.74, lngMax: 28.96 };
const W = 100;
const H = 100;

function project(lat: number, lng: number): { x: number; y: number } | null {
  if (lat < BBOX.latMin || lat > BBOX.latMax || lng < BBOX.lngMin || lng > BBOX.lngMax) return null;
  const x = ((lng - BBOX.lngMin) / (BBOX.lngMax - BBOX.lngMin)) * W;
  const y = H - ((lat - BBOX.latMin) / (BBOX.latMax - BBOX.latMin)) * H; // flip: north is up
  return { x, y };
}

const COURIER_FILL: Record<string, string> = {
  online: "#34d399",
  on_delivery: "#f5a623",
  offline: "#6b7280",
};

export function OpsMap({ fleet, orders }: { fleet: AdminFleetRow[]; orders: AdminOrderBoardRow[] }) {
  const couriers = fleet
    .map((c) => (c.lat != null && c.lng != null ? { ...c, p: project(c.lat, c.lng) } : null))
    .filter((c): c is AdminFleetRow & { p: { x: number; y: number } } => !!c && !!c.p);

  const drops = orders
    .map((o) => (o.delivery_lat != null && o.delivery_lng != null ? { ...o, p: project(o.delivery_lat, o.delivery_lng) } : null))
    .filter((o): o is AdminOrderBoardRow & { p: { x: number; y: number } } => !!o && !!o.p);

  return (
    <section className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/60">Hartă live · Chișinău</h2>
        <span className="text-xs text-white/40">
          {couriers.length} curieri · {drops.length} livrări
        </span>
      </div>
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-[#0b1020] ring-1 ring-white/5">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          {/* subtle grid */}
          {[25, 50, 75].map((g) => (
            <g key={g} stroke="rgba(255,255,255,0.04)" strokeWidth="0.3">
              <line x1={g} y1="0" x2={g} y2={H} />
              <line x1="0" y1={g} x2={W} y2={g} />
            </g>
          ))}
          {drops.map((o) => (
            <g key={`d-${o.id}`}>
              <circle cx={o.p.x} cy={o.p.y} r="1.4" fill="#e94560" opacity="0.9" />
              <circle cx={o.p.x} cy={o.p.y} r="2.6" fill="none" stroke="#e94560" strokeWidth="0.3" opacity="0.4" />
            </g>
          ))}
          {couriers.map((c) => (
            <circle
              key={`c-${c.id}`}
              cx={c.p.x}
              cy={c.p.y}
              r="1.8"
              fill={COURIER_FILL[c.status] ?? "#6b7280"}
              stroke="#0b1020"
              strokeWidth="0.4"
            />
          ))}
        </svg>
        {couriers.length === 0 && drops.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/30">
            Nicio poziție GPS activă
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-white/45">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> online</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gold" /> în livrare</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" /> adresă livrare</span>
      </div>
    </section>
  );
}
