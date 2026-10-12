// Scheduled orders: the kitchen must know WHEN to start cooking, not only when the bag is due.
// Start = estimated_ready_at − prep minutes (the order's own override, else the venue estimate).
// Only for accepted orders with a requested window; an ASAP order starts at accept.
export type StartCandidate = {
  id: string;
  status: string;
  requested_for: string | null;
  estimated_ready_at: string | null;
  prep_time_override_minutes: number | null;
};

export function prepStartAt(o: StartCandidate, venuePrepMinutes: number): number | null {
  if (o.status !== "accepted" || !o.requested_for || !o.estimated_ready_at) return null;
  const prep = o.prep_time_override_minutes ?? venuePrepMinutes;
  return Date.parse(o.estimated_ready_at) - prep * 60_000;
}

/** Orders whose start time has come and that have not rung yet (ring once, until a tap). */
export function startsDue(list: StartCandidate[], venuePrepMinutes: number, now: number, rung: ReadonlySet<string>): string[] {
  return list
    .filter((o) => {
      const at = prepStartAt(o, venuePrepMinutes);
      return at !== null && at <= now && !rung.has(o.id);
    })
    .map((o) => o.id);
}
