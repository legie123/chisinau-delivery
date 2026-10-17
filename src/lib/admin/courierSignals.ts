// Courier-side signals surfaced to ops (CROSS-REQUESTS: delivery_issue_reports 000205,
// courier_fee_distance_assumed 000202/000208, courier_order_releases + policy 000209).
// Pure: labels + the tri-state "km presupuși" flag + the versioned policy in effect.

// Values = the DB check constraints (delivery_issue_reports_kind_check / _leg_check,
// courier_order_releases_reason_check). A value added there without a label renders raw.
export const ISSUE_KIND_LABEL: Record<string, string> = {
  running_late: "Întârzie",
  restaurant_delayed: "Comanda nu e gata",
  venue_not_found: "Nu găsește restaurantul",
  customer_unreachable: "Clientul nu răspunde",
  address_wrong: "Adresă greșită",
};

export const ISSUE_LEG_LABEL: Record<string, string> = {
  pickup: "la ridicare",
  delivery: "la livrare",
};

export const RELEASE_REASON_LABEL: Record<string, string> = {
  vehicle_problem: "Problemă cu vehiculul",
  personal_emergency: "Urgență personală",
  restaurant_delay: "Întârziere la restaurant",
  other: "Alt motiv",
};

export function issueLabel(kind: string, leg: string): string {
  return `${ISSUE_KIND_LABEL[kind] ?? kind} ${ISSUE_LEG_LABEL[leg] ?? leg}`;
}

export type DistanceAssumedLabel = "presupus" | "măsurat" | "neevaluat";

/**
 * orders.courier_fee_distance_assumed is TRI-STATE: true = the courier was paid on the 6,0 km
 * assumption (a pin was missing), false = measured distance, null = never evaluated (every order
 * before 000208). null is NOT false — an old order must never read as "măsurat".
 */
export function distanceAssumedLabel(v: boolean | null | undefined): DistanceAssumedLabel {
  if (v === true) return "presupus";
  if (v === false) return "măsurat";
  return "neevaluat";
}

/** Per-payout summary of the same flag, e.g. "2 presupuși · 9 măsurați"; "—" for no orders. */
export function summarizeDistanceAssumed(values: (boolean | null | undefined)[]): string {
  let assumed = 0;
  let measured = 0;
  let unknown = 0;
  for (const v of values) {
    if (v === true) assumed++;
    else if (v === false) measured++;
    else unknown++;
  }
  const parts: string[] = [];
  if (assumed) parts.push(`${assumed} presupuși`);
  if (measured) parts.push(`${measured} măsurați`);
  if (unknown) parts.push(`${unknown} neevaluați`);
  return parts.length ? parts.join(" · ") : "—";
}

/** courier_release_policy.daily_cap: integer 0..20 (DB check). Empty or junk → null, never 0. */
export function parseDailyCap(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n <= 20 ? n : null;
}

/**
 * The version in effect from a NEWEST-FIRST list — same rule as current_courier_release_policy()
 * (`effective_from <= now() order by effective_from desc limit 1`) and /platform/tarife.
 */
export function currentVersion<T extends { effective_from: string }>(rows: T[], now: number = Date.now()): T | null {
  return rows.find((r) => new Date(r.effective_from).getTime() <= now) ?? null;
}
