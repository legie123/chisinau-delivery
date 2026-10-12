import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { getPublicPricingHistory } from "@chisinau/shared-api";
import {
  currentWeekRange,
  netForOrder,
  quotedNetMdl,
  summarizeEarnings,
  todayStart,
  type CommissionSource,
  type EarningsOrder,
  type EarningsSummary,
  type PricingVersion,
} from "@chisinau/shared-domain";

// Courier money on the phone = the payout, to the ban: the SAME canonical model
// as the web (@chisinau/shared-domain earnings — commission rounded per order,
// at the pricing_config version in effect at each order's delivered_at, exactly
// like admin_generate_payouts), the SAME row predicates as
// src/app/(courier)/deliveries/page.tsx ("today") and
// src/app/(courier)/earnings/page.tsx ("this week"), and the SAME
// Europe/Chisinau day/week windows whatever zone the phone is set to.
// The client is injected, so tests/earnings.localdb.test.ts runs these exact
// functions against the local DB.

type Db = SupabaseClient<Database>;

/** The live commission (offer cards, the rate banner). null = the read failed — callers must not cache that. */
export async function fetchCommissionPct(db: Db): Promise<number | null> {
  const { data, error } = await db.rpc("current_pricing_config");
  const pct = (data as { courier_commission_pct: number } | null)?.courier_commission_pct;
  return error || pct == null ? null : Number(pct);
}

/** public_pricing_history(), oldest first. [] = the read failed (soft-fail, never cache). */
export async function fetchPricingHistory(db: Db): Promise<PricingVersion[]> {
  return (await getPublicPricingHistory(db)) as PricingVersion[];
}

export async function fetchEarningsSince(
  db: Db,
  courierId: string,
  start: Date,
  end: Date | null,
  commission: CommissionSource,
): Promise<EarningsSummary> {
  let q = db
    .from("orders")
    .select("delivery_fee_mdl, courier_fee_mdl, tip_mdl, payment_status, delivered_at")
    .eq("courier_id", courierId)
    .eq("status", "delivered")
    .gte("delivered_at", start.toISOString());
  if (end) q = q.lt("delivered_at", end.toISOString());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return summarizeEarnings((data ?? []) as EarningsOrder[], commission);
}

export function fetchTodayEarnings(db: Db, courierId: string, commission: CommissionSource, now = new Date()) {
  return fetchEarningsSince(db, courierId, todayStart(now), null, commission);
}

export function fetchWeekEarnings(db: Db, courierId: string, commission: CommissionSource, now = new Date()) {
  const { start, end } = currentWeekRange(now);
  return fetchEarningsSince(db, courierId, start, end, commission);
}

// What the OFFER / available-order card promises: the net of the quoted fee
// (a floor — the final stamp at delivery can only be higher), tip excluded.
// The delivery has not happened yet, so the CURRENT rate is the right one.
export function offerNetLabel(
  order: { courier_fee_quoted_mdl?: number | null; courier_fee_mdl?: number | null; delivery_fee_mdl: number },
  commissionPct: number,
): string {
  return `${quotedNetMdl(order, commissionPct)} MDL net`;
}

// Per-delivery line in the history list; null = delivered but not settled yet.
export function historyNet(o: EarningsOrder, commission: CommissionSource): number | null {
  return netForOrder(o, commission);
}

// payouts.period_start/end are DATES ("2026-11-02"): `new Date` reads them as UTC midnight, so they
// are formatted in UTC — in the phone's zone a courier west of UTC saw every period a day early.
// Same as the web's fmtDate (src/app/(courier)/earnings/page.tsx).
export function payoutPeriodLabel(start: string, end: string): string {
  const fmt = (d: string) => new Date(d).toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Per-delivery tip line in the history ("incl." because the net already contains it). */
export function historyTipLabel(tip: number | string | null | undefined): string | null {
  const n = tip === null || tip === undefined || tip === "" ? NaN : Number(tip);
  return Number.isFinite(n) && n > 0 ? `incl. bacșiș ${n} MDL` : null;
}

/** orders.courier_fee_distance_assumed: only true is worth a note (false = measured, null = not evaluated). */
export function historyFeeNote(assumed: boolean | null | undefined): string | null {
  return assumed === true ? "tarif de bază (lipsea un pin) — km se adaugă la revizuire" : null;
}

/** Extra lines under a history row, in display order: the tip first, then the fee note. */
export function historyExtraLines(row: { tipLabel: string | null; feeNote: string | null }): string[] {
  return [row.tipLabel, row.feeNote].filter((l): l is string => l !== null);
}
