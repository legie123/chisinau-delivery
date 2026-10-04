import { describe, expect, it } from "vitest";
import { fetchEarningsSince, offerNetLabel, historyNet } from "../src/lib/earnings";

// Fixture = the REAL delivered orders of the seeded courier curier@test.md in
// the local DB (captured 2026-10-03 with psql; 9 rows: 8 paid, 1 unpaid cash,
// 5 with a stamped courier tariff, 3 tipped). Commission 15% (current_pricing_config).
// Independent SQL on the same rows (admin_generate_payouts' formula):
//   gross 399.79, Σ per-order commission 44.51 → payout net 355.28.
// shared-domain summarizeEarnings now rounds per order exactly like that, so
// web == phone == payout, to the ban (it used to round once on the fee total
// and show 44.52 / 355.27).
const ROWS = [
  { delivery_fee_mdl: 45.0, courier_fee_mdl: null, courier_fee_quoted_mdl: null, tip_mdl: 0.0, payment_status: "paid" },
  { delivery_fee_mdl: 40.0, courier_fee_mdl: null, courier_fee_quoted_mdl: null, tip_mdl: 20.0, payment_status: "paid" },
  { delivery_fee_mdl: 42.0, courier_fee_mdl: null, courier_fee_quoted_mdl: null, tip_mdl: 5.0, payment_status: "paid" },
  { delivery_fee_mdl: 38.0, courier_fee_mdl: null, courier_fee_quoted_mdl: null, tip_mdl: 0.0, payment_status: "unpaid" },
  { delivery_fee_mdl: 45.0, courier_fee_mdl: 46.83, courier_fee_quoted_mdl: null, tip_mdl: 0.0, payment_status: "paid" },
  { delivery_fee_mdl: 45.0, courier_fee_mdl: 30.74, courier_fee_quoted_mdl: 30.74, tip_mdl: 0.0, payment_status: "paid" },
  { delivery_fee_mdl: 45.0, courier_fee_mdl: 30.74, courier_fee_quoted_mdl: 30.74, tip_mdl: 0.0, payment_status: "paid" },
  { delivery_fee_mdl: 45.0, courier_fee_mdl: 30.74, courier_fee_quoted_mdl: 30.74, tip_mdl: 0.0, payment_status: "paid" },
  { delivery_fee_mdl: 45.0, courier_fee_mdl: 30.74, courier_fee_quoted_mdl: 30.74, tip_mdl: 78.0, payment_status: "paid" },
];
const PCT = 15;

// Fake PostgREST builder: records the filters and resolves to the fixture rows.
function fakeDb(rows: unknown[]) {
  const filters: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gte", "lt", "is", "in"]) {
    builder[op] = (...args: unknown[]) => {
      filters.push(`${op}(${args.map(String).join(",")})`);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  const db = { from: (t: string) => (filters.push(`from(${t})`), builder) };
  return { db: db as never, filters };
}

describe("courier money on the phone = web model (BLOCKER: was gross)", () => {
  it("week/today summary is NET after the live commission, unpaid cash counted apart", async () => {
    const { db, filters } = fakeDb(ROWS);
    const start = new Date("2026-07-01T00:00:00Z");
    const end = new Date("2026-10-01T00:00:00Z");
    const s = await fetchEarningsSince(db, "courier-1", start, end, PCT);

    expect(s).toEqual({ ordersCount: 8, grossMdl: 399.79, commissionMdl: 44.51, netMdl: 355.28, pendingCount: 1 });

    // the web's predicates: own orders, delivered, delivered_at window
    expect(filters).toEqual([
      "from(orders)",
      "select(delivery_fee_mdl, courier_fee_mdl, tip_mdl, payment_status, delivered_at)",
      "eq(courier_id,courier-1)",
      "eq(status,delivered)",
      `gte(delivered_at,${start.toISOString()})`,
      `lt(delivered_at,${end.toISOString()})`,
    ]);
  });

  it("offer card promises the NET of the quoted fee (floor), not the gross fee", () => {
    expect(offerNetLabel({ delivery_fee_mdl: 45, courier_fee_quoted_mdl: 30.74, courier_fee_mdl: null }, PCT)).toBe("26.13 MDL net");
    expect(offerNetLabel({ delivery_fee_mdl: 45, courier_fee_quoted_mdl: null, courier_fee_mdl: null }, PCT)).toBe("38.25 MDL net");
  });

  it("history line: net incl. tip for a settled delivery, null (neîncasat) for unpaid cash", () => {
    expect(historyNet({ delivery_fee_mdl: 45, courier_fee_mdl: 30.74, tip_mdl: 78, payment_status: "paid" }, PCT)).toBe(104.13);
    expect(historyNet({ delivery_fee_mdl: 38, courier_fee_mdl: null, tip_mdl: 0, payment_status: "unpaid" }, PCT)).toBeNull();
  });
});
