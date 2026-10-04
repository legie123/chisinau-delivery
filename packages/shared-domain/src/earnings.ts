// Canonical courier earnings model (#3b) — the ONE place that decides what a
// courier "earned" on an order, so Earnings and History never show two
// different numbers for the same delivery.
//
// Formula mirrors the courier loop in admin_generate_payouts exactly
// (supabase/migrations/20260727000900_courier_tariff.sql — the fee source
// swapped 1:1 with that migration's coalesce(courier_fee_mdl, delivery_fee_mdl)):
//   fee = courier_fee_mdl ?? delivery_fee_mdl (order 2: per-delivery tariff,
//         final stamped at delivered; falls back to the flat delivery fee for
//         any order that predates the tariff or never got a final stamped)
//   net = (fee + tip_mdl) - round(fee * commission_pct / 100, 2)
// rounded PER ORDER, half away from zero on the exact decimal (Postgres numeric
// round), then summed — done here in integer bani, never on floats: 21.90 × 15%
// = 3.285 is 3.2849999… as a double and would round the wrong way.
// commission_pct is the pricing_config version in effect at the order's
// delivered_at (pricing_config_at). Pass the public pricing history to get
// that per order; a bare number applies one rate to every order.
// i.e. tips are the courier's in full; commission is taken on the delivery
// fee only. Only status='delivered' AND payment_status='paid' orders count —
// anything else is "pending" (#3c: cash not yet collected / online not yet
// captured / disputed) and must be excluded from sums, never silently folded
// into a number that looks final.
//
// Fallback only: pages read the live rate from the courier-readable pricing config
// (see deliveries/page.tsx, earnings/page.tsx); this mirrors its default if that read fails.
export const COMMISSION_PCT = 15;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// MDL (2 decimals, numeric(10,2) in the DB) → integer bani.
const toBani = (mdl: number | string | null | undefined) => Math.round(Number(mdl ?? 0) * 100);

// Postgres round(fee * pct / 100, 2) on exact decimals, in bani. pct is
// numeric(5,2), so fee_bani × pct_hundredths is an exact integer; /10_000 → bani.
function commissionBani(feeBani: number, pct: number): number {
  const p = feeBani * Math.round(pct * 100);
  return Math.sign(p) * Math.floor((Math.abs(p) + 5000) / 10_000);
}

// One row of public_pricing_history() (shared-api getPublicPricingHistory).
export type PricingVersion = { effective_from: string; courier_pct: number | string };
// One rate for every order, or the history to resolve each order's own rate.
export type CommissionSource = number | readonly PricingVersion[];

// pricing_config_at(): latest version with effective_from <= ts (null ts = now).
// No version yet → fallbackPct, as the payout falls back to platform_settings.
// ponytail: compares at millisecond precision; Postgres keeps microseconds.
export function pctAt(
  history: readonly PricingVersion[],
  deliveredAtIso: string | null | undefined,
  fallbackPct: number = COMMISSION_PCT,
): number {
  const ts = deliveredAtIso ? Date.parse(deliveredAtIso) : Date.now();
  let best: PricingVersion | null = null;
  for (const v of history) {
    const from = Date.parse(v.effective_from);
    if (from <= ts && (!best || from >= Date.parse(best.effective_from))) best = v;
  }
  return best ? Number(best.courier_pct) : fallbackPct;
}

function pctFor(o: { delivered_at?: string | null }, commission: CommissionSource): number {
  return typeof commission === "number" ? commission : pctAt(commission, o.delivered_at);
}

// --- Europe/Chisinau calendar (service time), independent of the device zone ---
// Built on first use, not at import: every app imports this package's index.
let zoneParts: Intl.DateTimeFormat | null = null;

// Chisinau wall clock at instant `ms`, read back as if it were UTC.
function wallAsUtc(ms: number): number {
  zoneParts ??= new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Chisinau",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const x of zoneParts.formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second); // some engines print midnight as 24
}

// Chisinau 00:00 of calendar day (y, m0, d) as an instant. Midnight is never in
// a DST gap/overlap there (the switches happen at 03:00/04:00 local).
function chisinauMidnight(y: number, m0: number, d: number): Date {
  const wall = Date.UTC(y, m0, d);
  let t = wall - (wallAsUtc(wall) - wall);
  t = wall - (wallAsUtc(t) - t); // re-read the offset at the candidate instant
  return new Date(t);
}

// Chisinau calendar day of `now`, as a UTC-midnight Date (calendar maths only).
function chisinauDay(now: Date): Date {
  const w = new Date(wallAsUtc(now.getTime()));
  return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()));
}

/** Chisinau calendar date of `now`, "YYYY-MM-DD". */
export function chisinauDate(now: Date): string {
  return chisinauDay(now).toISOString().slice(0, 10);
}

/** 00:00 Chisinau of `now`'s day, as an instant (never the device's midnight). */
export function todayStart(now: Date): Date {
  const d = chisinauDay(now);
  return chisinauMidnight(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Monday 00:00 .. next Monday 00:00 in Europe/Chisinau, whatever zone the
// device or server runs in. `startDate` is that Monday as "YYYY-MM-DD" — equal
// to date_trunc('week', now() at time zone 'Europe/Chisinau')::date, the key the
// server stores the weekly survey under. A DST week lasts 167h/169h, so `end`
// is the next Chisinau midnight, never start + 7×24h.
export function currentWeekRange(now: Date): { start: Date; end: Date; startDate: string } {
  const day = chisinauDay(now);
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000);
  const [y, m, d] = [monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()];
  return {
    start: chisinauMidnight(y, m, d),
    end: chisinauMidnight(y, m, d + 7),
    startDate: monday.toISOString().slice(0, 10),
  };
}

export type EarningsOrder = {
  delivery_fee_mdl: number;
  courier_fee_mdl?: number | null;
  tip_mdl: number | null;
  payment_status: string;
  // Read only when a pricing history is passed (per-order commission).
  delivered_at?: string | null;
};

// Order 2 — the courier's actual fee: the final tariff stamp if it exists,
// else the flat delivery fee (legacy orders / anything pre-tariff).
function courierFee(o: EarningsOrder): number {
  return Number(o.courier_fee_mdl ?? o.delivery_fee_mdl);
}

// Per-order net — what a single delivery is actually worth to the courier.
// Returns null for anything not settleable yet (see module doc); callers use
// that to render a "neîncasat / pending" state instead of a number.
export function netForOrder(o: EarningsOrder, commission: CommissionSource = COMMISSION_PCT): number | null {
  if (o.payment_status !== "paid") return null;
  const fee = toBani(courierFee(o));
  return (fee + toBani(o.tip_mdl) - commissionBani(fee, pctFor(o, commission))) / 100;
}

// R8 — ce i se promite curierului ÎNAINTE de cursă, în aceeași monedă în care
// i se plătește DUPĂ ea. Până azi suprafața de decizie (oferta de 30s, lista de
// comenzi) afișa taxa BRUTĂ sub cuvântul „Câștig", iar `/earnings` și payout-ul
// real spuneau net — două definiții pentru același cuvânt, pe ecrane care nu se
// văd niciodată împreună. Formula e a lui `netForOrder` de mai sus, fără bacșiș:
// bacșișul e integral al curierului și rămâne un chip separat în UI, exact ca
// până acum.
//
// `courier_fee_quoted_mdl` e o PODEA (order 2: finalul ștampilat la livrare
// poate fi doar mai mare), deci și netul derivat din ea e o podea — de-aia
// eticheta din UI rămâne „tarif minim".
export function quotedNetMdl(
  o: { courier_fee_quoted_mdl?: number | null; courier_fee_mdl?: number | null; delivery_fee_mdl: number },
  commissionPct: number = COMMISSION_PCT,
): number {
  const fee = toBani(o.courier_fee_mdl ?? o.courier_fee_quoted_mdl ?? o.delivery_fee_mdl);
  return (fee - commissionBani(fee, commissionPct)) / 100;
}

// Faza 5 #5 — gross earnings PER SHIFT ("tura"), the audit's go/no-go instrument
// (target 600-1000 MDL/tura completa). A shift is [started_at, ended_at) from
// courier_shifts; only delivered+paid orders whose delivered_at falls in that
// span count, same predicate as netForOrder/summarizeEarnings above.
export type ShiftEarningsOrder = EarningsOrder & { delivered_at: string };

export type ShiftSummary = {
  id: string;
  startedAt: string;
  endedAt: string;
  ordersCount: number;
  grossMdl: number;
};

// Faza 5 #5 target band, 600-1000 MDL gross/tură (Chișinău modal interval from
// the audit). For the ADMIN go/no-go table it is a band with two edges; on the
// courier's own screen only the FLOOR may drive the visual cue. Highlighting
// "inside 600-1000" and dropping the highlight above 1000 makes the best shift
// of the month render dimmer than an average one — the money going up would
// look like the money going down. The ceiling stays written down, not painted.
export const SHIFT_TARGET_MIN = 600;
export const SHIFT_TARGET_MAX = 1000;

export function shiftReachesTarget(grossMdl: number): boolean {
  return grossMdl >= SHIFT_TARGET_MIN;
}

// Round ONCE, to whole minutes, then split. Rounding hours and minutes
// independently prints an impossible clock: a shift of 10h 59m 46s has
// floor(h)=10 and round(59.76)=60, i.e. "10h 60m" — seen live on the seeded
// courier's 13 aug. shift (659.76 min).
export function formatShiftDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function summarizeShifts(
  shifts: { id: string; started_at: string; ended_at: string }[],
  orders: ShiftEarningsOrder[],
): ShiftSummary[] {
  return shifts.map((s) => {
    const start = new Date(s.started_at).getTime();
    const end = new Date(s.ended_at).getTime();
    let ordersCount = 0;
    let grossMdl = 0;
    for (const o of orders) {
      if (o.payment_status !== "paid") continue;
      const deliveredAt = new Date(o.delivered_at).getTime();
      if (deliveredAt >= start && deliveredAt < end) {
        ordersCount += 1;
        grossMdl += courierFee(o) + Number(o.tip_mdl ?? 0);
      }
    }
    return { id: s.id, startedAt: s.started_at, endedAt: s.ended_at, ordersCount, grossMdl: round2(grossMdl) };
  });
}

export type EarningsSummary = {
  ordersCount: number;
  grossMdl: number;
  commissionMdl: number;
  netMdl: number;
  pendingCount: number;
};

// Aggregate over a set of delivered orders — same shape the payout cards use
// (brut/comision/net), so the in-progress week reads like a preview of the
// payout it will become, not a different metric.
export function summarizeEarnings(orders: EarningsOrder[], commission: CommissionSource = COMMISSION_PCT): EarningsSummary {
  let gross = 0;
  let comm = 0;
  let ordersCount = 0;
  let pendingCount = 0;
  for (const o of orders) {
    if (o.payment_status === "paid") {
      const fee = toBani(courierFee(o));
      gross += fee + toBani(o.tip_mdl);
      comm += commissionBani(fee, pctFor(o, commission));
      ordersCount += 1;
    } else {
      pendingCount += 1;
    }
  }
  return { ordersCount, grossMdl: gross / 100, commissionMdl: comm / 100, netMdl: (gross - comm) / 100, pendingCount };
}
