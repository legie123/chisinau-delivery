// Scheduled orders ("Programează livrarea") — shared display/logic helpers.
// Mirrors the DB-side rules from migration 20260811000000_scheduled_orders_honesty:
// the accept-SLA clock anchors 60 min before the requested window, dispatch holds
// until 45 min before it. Pure functions, safe in server and client components.

/** Lead time (min) before the requested window when the order becomes "live"
 *  for the restaurant (accept-SLA starts). Keep in sync with the migration. */
export const SCHEDULED_SLA_LEAD_MIN = 60;

const fmt = new Intl.DateTimeFormat("ro-RO", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Chisinau",
});

/** "12 aug., 13:00" — deterministic across SSR/CSR (timezone pinned). */
export function formatScheduledFor(requestedFor: string): string {
  return fmt.format(new Date(requestedFor));
}

/** True while the scheduled window is still far enough away that the order
 *  should read as "programmed", not as a live order under an accept-SLA. */
export function isScheduledStillAhead(requestedFor: string | null, now = Date.now()): boolean {
  if (!requestedFor) return false;
  return new Date(requestedFor).getTime() - SCHEDULED_SLA_LEAD_MIN * 60_000 > now;
}
