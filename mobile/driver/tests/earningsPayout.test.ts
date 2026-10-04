import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchCommissionPct, fetchEarningsSince, fetchTodayEarnings, fetchWeekEarnings, historyNet } from "../src/lib/earnings";

// MED x2 from the verifier: the phone's net must be what admin_generate_payouts
// pays (commission of the pricing_config version in effect at EACH order's
// delivered_at, rounded per order) and "Azi" / "Săptămâna aceasta" must be the
// Europe/Chisinau day/week whatever zone the phone is in.

// public_pricing_history() shape, oldest first: 15% until 2026-10-01, then 20%.
const HISTORY = [
  { effective_from: "2026-01-01T00:00:00+00:00", courier_pct: 15 },
  { effective_from: "2026-10-01T00:00:00+00:00", courier_pct: 20 },
];

// Two real-shaped rows from the verifier's probe (CHD-2026-000023 / -000476),
// delivered while 15% was in effect, then a 20% one after the change.
const ROWS = [
  { delivery_fee_mdl: 45, courier_fee_mdl: null, tip_mdl: 0, payment_status: "paid", delivered_at: "2026-09-29T10:00:00Z" },
  { delivery_fee_mdl: 45, courier_fee_mdl: 30.74, tip_mdl: 0, payment_status: "paid", delivered_at: "2026-09-30T18:00:00Z" },
  { delivery_fee_mdl: 40, courier_fee_mdl: null, tip_mdl: 10, payment_status: "paid", delivered_at: "2026-10-02T12:00:00Z" },
];

function fakeDb(rows: unknown[], rpcResult: { data: unknown; error: unknown } = { data: null, error: null }) {
  const filters: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gte", "lt"]) {
    builder[op] = (...args: unknown[]) => {
      filters.push(`${op}(${args.map(String).join(",")})`);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  const db = { from: () => builder, rpc: async () => rpcResult };
  return { db: db as never, filters };
}

describe("phone net = payout net, per order at delivered_at", () => {
  it("history lines use each order's own version (the verifier saw 36 / 24.59 vs payout 38.25 / 26.13)", () => {
    expect(historyNet(ROWS[0], HISTORY as never)).toBe(38.25);
    expect(historyNet(ROWS[1], HISTORY as never)).toBe(26.13);
    expect(historyNet(ROWS[2], HISTORY as never)).toBe(42); // 40 + 10 − 8 (20%)
  });

  it("the period summary reads delivered_at and applies 15% + 15% + 20%, not 3 × the current 20%", async () => {
    const { db, filters } = fakeDb(ROWS);
    const s = await fetchEarningsSince(db, "c1", new Date("2026-09-28T00:00:00Z"), null, HISTORY as never);
    // payout: Σ round(fee × pct_at/100, 2) = 6.75 + 4.61 + 8.00 = 19.36
    expect(s).toEqual({ ordersCount: 3, grossMdl: 125.74, commissionMdl: 19.36, netMdl: 106.38, pendingCount: 0 });
    expect(filters[0]).toMatch(/delivered_at/);
  });

  it("current_pricing_config failing reads as null (not a silent 15% that gets cached)", async () => {
    const { db } = fakeDb([], { data: null, error: { message: "JWT expired" } });
    expect(await fetchCommissionPct(db)).toBeNull();
  });
});

describe("Azi / Săptămâna aceasta are Europe/Chisinau windows on a phone set to New York", () => {
  const saved = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    process.env.TZ = saved;
  });

  it("today starts at Chisinau midnight (verifier: app window started 7h late, net 0 vs 104.13)", async () => {
    const { db, filters } = fakeDb([]);
    await fetchTodayEarnings(db, "c1", 15, new Date("2026-08-14T07:00:00Z"));
    expect(filters).toContain("gte(delivered_at,2026-08-13T21:00:00.000Z)");
  });

  it("the week is Monday 00:00 .. next Monday 00:00 Chisinau", async () => {
    const { db, filters } = fakeDb([]);
    await fetchWeekEarnings(db, "c1", 15, new Date("2026-08-09T22:30:00Z")); // Mon 01:30 Chisinau
    expect(filters).toContain("gte(delivered_at,2026-08-09T21:00:00.000Z)");
    expect(filters).toContain("lt(delivered_at,2026-08-16T21:00:00.000Z)");
  });
});
