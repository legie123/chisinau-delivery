import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import {
  COMMISSION_PCT,
  currentWeekRange,
  netForOrder,
  quotedNetMdl,
  summarizeEarnings,
  type EarningsOrder,
  type EarningsSummary,
} from "@chisinau/shared-domain";

// Courier money on the phone = the web's money, by construction: the SAME
// canonical model (@chisinau/shared-domain earnings — what admin_generate_payouts
// pays), the SAME live commission (current_pricing_config) and the SAME row
// predicates as src/app/(courier)/deliveries/page.tsx ("today") and
// src/app/(courier)/earnings/page.tsx ("this week"). The client is injected, so
// tests/earnings.localdb.test.ts runs these exact functions against the local DB.
//
// The old app showed GROSS: courier fee without commission everywhere, and the
// "today" figure also counted delivered-but-unpaid cash (never settled yet).

type Db = SupabaseClient<Database>;

// Mirrors the web: a failed read falls back to the documented default rate.
export async function fetchCommissionPct(db: Db): Promise<number> {
  const { data } = await db.rpc("current_pricing_config");
  const pct = (data as { courier_commission_pct: number } | null)?.courier_commission_pct;
  return pct != null ? Number(pct) : COMMISSION_PCT;
}

export async function fetchEarningsSince(
  db: Db,
  courierId: string,
  start: Date,
  end: Date | null,
  commissionPct: number,
): Promise<EarningsSummary> {
  let q = db
    .from("orders")
    .select("delivery_fee_mdl, courier_fee_mdl, tip_mdl, payment_status")
    .eq("courier_id", courierId)
    .eq("status", "delivered")
    .gte("delivered_at", start.toISOString());
  if (end) q = q.lt("delivered_at", end.toISOString());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return summarizeEarnings((data ?? []) as EarningsOrder[], commissionPct);
}

export function todayStart(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function fetchTodayEarnings(db: Db, courierId: string, commissionPct: number, now = new Date()) {
  return fetchEarningsSince(db, courierId, todayStart(now), null, commissionPct);
}

export function fetchWeekEarnings(db: Db, courierId: string, commissionPct: number, now = new Date()) {
  const { start, end } = currentWeekRange(now);
  return fetchEarningsSince(db, courierId, start, end, commissionPct);
}

// What the OFFER / available-order card promises: the net of the quoted fee
// (a floor — the final stamp at delivery can only be higher), tip excluded.
export function offerNetLabel(
  order: { courier_fee_quoted_mdl?: number | null; courier_fee_mdl?: number | null; delivery_fee_mdl: number },
  commissionPct: number,
): string {
  return `${quotedNetMdl(order, commissionPct)} MDL net`;
}

// Per-delivery line in the history list; null = delivered but not settled yet.
export function historyNet(o: EarningsOrder, commissionPct: number): number | null {
  return netForOrder(o, commissionPct);
}
