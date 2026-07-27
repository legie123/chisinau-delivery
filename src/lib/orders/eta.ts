// WS4 — Dynamic ETA helpers. Prep time comes from get_prep_estimates (historical
// rolling avg + p90, with a static fallback); courier travel is a fixed placeholder
// until WS3 (PostGIS) supplies a real distance-based leg.

import type { PrepEstimate } from "@/lib/types/domain";

// Courier pickup->dropoff travel placeholder, in minutes. Replaced by WS3 geo later.
// Also formatPrepRange's LAST-RESORT upper-bound fallback, for restaurants with no
// p90 sample yet (source="static", or "hourly"/"overall" with too few samples —
// get_prep_estimates already null-safes p90_prep_minutes for both cases).
export const DELIVERY_BUFFER_MIN = 15;

// A p90 barely above the average would render as a near-zero-width range
// ("25–26 min"), which reads as false precision rather than "consistent
// kitchen". Floor the spread so the upper bound always means something.
const MIN_SPREAD_FLOOR_MIN = 5;

// "25–40 min" — prep .. prep + variability spread. Used on browse + menu cards.
// Point = avg prep time. Upper bound = p90 (a real 90th-percentile outcome for
// this restaurant/hour) when available, floored so it's never a sliver above
// the point; falls back to the fixed DELIVERY_BUFFER_MIN buffer only when no
// p90 sample backs the estimate (accepts either the full RPC row or a bare
// number, so static-column fallbacks — e.g. `?? restaurant.avg_prep_minutes` —
// keep working unchanged).
export function formatPrepRange(
  estimate: number | Pick<PrepEstimate, "prep_minutes" | "p90_prep_minutes">,
): string {
  const prepMinutes = typeof estimate === "number" ? estimate : estimate.prep_minutes;
  const p90 = typeof estimate === "number" ? null : estimate.p90_prep_minutes;

  const low = Math.max(1, Math.round(prepMinutes));
  const high =
    p90 != null && p90 > prepMinutes
      ? low + Math.max(Math.round(p90 - prepMinutes), MIN_SPREAD_FLOOR_MIN)
      : low + DELIVERY_BUFFER_MIN;
  return `${low}–${high} min`;
}

// Whole minutes from now until an ISO timestamp; negative once past due.
export function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

// "14:35" in Europe/Chisinau clock time for an ISO timestamp — pinned to the
// service timezone so it's correct regardless of where the app is deployed.
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Chisinau",
  });
}
