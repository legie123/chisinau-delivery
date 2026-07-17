// WS4 — Dynamic ETA helpers. Prep time comes from get_prep_estimates (historical
// rolling avg with a static fallback); courier travel is a fixed placeholder until
// WS3 (PostGIS) supplies a real distance-based leg.

// Courier pickup->dropoff travel placeholder, in minutes. Replaced by WS3 geo later.
export const DELIVERY_BUFFER_MIN = 15;

// "25–40 min" — prep .. prep + travel buffer. Used on browse + menu cards.
export function formatPrepRange(prepMinutes: number): string {
  const low = Math.max(1, Math.round(prepMinutes));
  const high = low + DELIVERY_BUFFER_MIN;
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
