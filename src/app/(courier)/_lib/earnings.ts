// Canonical courier earnings model (#3b) — the ONE place that decides what a
// courier "earned" on an order, so Earnings and History never show two
// different numbers for the same delivery.
//
// Formula mirrors the courier loop in admin_generate_payouts exactly
// (supabase/migrations/20260725000700_wave9b_payout_lock.sql, body unchanged
// since 20260725000100_money_integrity.sql):
//   net = (delivery_fee_mdl + tip_mdl) - round(delivery_fee_mdl * commission_pct / 100, 2)
// i.e. tips are the courier's in full; commission is taken on the delivery
// fee only. Only status='delivered' AND payment_status='paid' orders count —
// anything else is "pending" (#3c: cash not yet collected / online not yet
// captured / disputed) and must be excluded from sums, never silently folded
// into a number that looks final.
//
// courier_commission_pct lives in public.platform_settings, but that table's
// only RLS policy is "platform_settings_admin" (has_role('platform_admin')) —
// see supabase/migrations/20260718000000_platform_foundation.sql. A
// courier-facing Server Component genuinely cannot read it (and adding a read
// policy is a migration change, out of this fix's scope). COMMISSION_PCT
// mirrors that table's default; keep it in sync if an admin ever changes it.
export const COMMISSION_PCT = 15;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Monday 00:00 .. next Monday 00:00, in the server's local time — the same
// week boundary admin payout periods use (src/lib/time.ts lastWeekRange),
// just for the CURRENT, still-open week instead of the last closed one.
export function currentWeekRange(now: Date = new Date()): { start: Date; end: Date } {
  const day = now.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - daysSinceMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

export type EarningsOrder = {
  delivery_fee_mdl: number;
  tip_mdl: number | null;
  payment_status: string;
};

// Per-order net — what a single delivery is actually worth to the courier.
// Returns null for anything not settleable yet (see module doc); callers use
// that to render a "neîncasat / pending" state instead of a number.
export function netForOrder(o: EarningsOrder, commissionPct: number = COMMISSION_PCT): number | null {
  if (o.payment_status !== "paid") return null;
  const fee = Number(o.delivery_fee_mdl);
  const commission = round2(fee * (commissionPct / 100));
  return round2(fee + Number(o.tip_mdl ?? 0) - commission);
}

// Faza 5 #5 — gross earnings PER SHIFT ("tura"), the audit's go/no-go instrument
// (target 600-1000 MDL/tura completa). A shift is [started_at, ended_at) from
// courier_shifts; only delivered+paid orders whose delivered_at falls in that
// window count, same predicate as netForOrder/summarizeEarnings above.
export type ShiftEarningsOrder = EarningsOrder & { delivered_at: string };

export type ShiftSummary = {
  id: string;
  startedAt: string;
  endedAt: string;
  ordersCount: number;
  grossMdl: number;
};

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
        grossMdl += Number(o.delivery_fee_mdl) + Number(o.tip_mdl ?? 0);
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
export function summarizeEarnings(orders: EarningsOrder[], commissionPct: number = COMMISSION_PCT): EarningsSummary {
  let grossMdl = 0;
  let feesMdl = 0;
  let ordersCount = 0;
  let pendingCount = 0;
  for (const o of orders) {
    if (o.payment_status === "paid") {
      grossMdl += Number(o.delivery_fee_mdl) + Number(o.tip_mdl ?? 0);
      feesMdl += Number(o.delivery_fee_mdl);
      ordersCount += 1;
    } else {
      pendingCount += 1;
    }
  }
  const commissionMdl = round2(feesMdl * (commissionPct / 100));
  return {
    ordersCount,
    grossMdl: round2(grossMdl),
    commissionMdl,
    netMdl: round2(grossMdl - commissionMdl),
    pendingCount,
  };
}
