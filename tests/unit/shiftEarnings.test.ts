import { describe, expect, it } from "vitest";
import { summarizeShifts, type ShiftEarningsOrder } from "@/app/(courier)/_lib/earnings";

// Faza 5 #5 — gross-per-shift is the go/no-go instrument (target 600-1000
// MDL/tura); the window-bucketing logic is exactly the kind of off-by-one
// that would silently misreport the KPI, so it gets a dedicated unit test.
describe("summarizeShifts", () => {
  const shifts = [
    { id: "s1", started_at: "2026-01-01T08:00:00.000Z", ended_at: "2026-01-01T12:00:00.000Z" },
    { id: "s2", started_at: "2026-01-02T08:00:00.000Z", ended_at: "2026-01-02T12:00:00.000Z" },
  ];

  it("only counts orders whose delivered_at falls in [started_at, ended_at)", () => {
    const orders: ShiftEarningsOrder[] = [
      { delivery_fee_mdl: 40, tip_mdl: 10, payment_status: "paid", delivered_at: "2026-01-01T09:00:00.000Z" }, // in s1
      { delivery_fee_mdl: 30, tip_mdl: 0, payment_status: "paid", delivered_at: "2026-01-01T12:00:00.000Z" }, // exactly at s1's end — excluded
      { delivery_fee_mdl: 50, tip_mdl: 5, payment_status: "paid", delivered_at: "2026-01-02T10:00:00.000Z" }, // in s2
      { delivery_fee_mdl: 20, tip_mdl: 0, payment_status: "paid", delivered_at: "2026-01-03T10:00:00.000Z" }, // outside both
    ];

    const result = summarizeShifts(shifts, orders);

    expect(result).toEqual([
      { id: "s1", startedAt: shifts[0].started_at, endedAt: shifts[0].ended_at, ordersCount: 1, grossMdl: 50 },
      { id: "s2", startedAt: shifts[1].started_at, endedAt: shifts[1].ended_at, ordersCount: 1, grossMdl: 55 },
    ]);
  });

  it("excludes non-paid orders (pending cash / disputed) from gross", () => {
    const orders: ShiftEarningsOrder[] = [
      { delivery_fee_mdl: 40, tip_mdl: 10, payment_status: "paid", delivered_at: "2026-01-01T09:00:00.000Z" },
      { delivery_fee_mdl: 100, tip_mdl: 0, payment_status: "unpaid", delivered_at: "2026-01-01T09:30:00.000Z" },
      { delivery_fee_mdl: 100, tip_mdl: 0, payment_status: "refund_pending", delivered_at: "2026-01-01T09:45:00.000Z" },
    ];

    const [s1] = summarizeShifts([shifts[0]], orders);
    expect(s1.ordersCount).toBe(1);
    expect(s1.grossMdl).toBe(50);
  });

  it("returns a zero shift when no order lands in its window", () => {
    const [s1] = summarizeShifts([shifts[0]], []);
    expect(s1).toEqual({ id: "s1", startedAt: shifts[0].started_at, endedAt: shifts[0].ended_at, ordersCount: 0, grossMdl: 0 });
  });
});
