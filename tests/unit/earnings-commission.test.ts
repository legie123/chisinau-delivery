import { describe, expect, it } from "vitest";
import { summarizeEarnings, netForOrder, type EarningsOrder } from "@/app/(courier)/_lib/earnings";

// DispatchCourierAudit #2 — /earnings showed the CURRENT commission in the banner
// but computed Net/Comision with a hardcoded 15% default, so the two could
// disagree on the same page. The page now passes the live courier_commission_pct
// into summarizeEarnings; this locks the lib contract it relies on: the commission
// is driven by the passed pct, not a constant.
describe("summarizeEarnings commission pct", () => {
  const orders: EarningsOrder[] = [
    { delivery_fee_mdl: 100, courier_fee_mdl: 100, tip_mdl: 0, payment_status: "paid" },
    { delivery_fee_mdl: 100, courier_fee_mdl: 100, tip_mdl: 0, payment_status: "paid" },
  ];

  it("defaults to 15% when no pct is passed", () => {
    const s = summarizeEarnings(orders);
    expect(s.commissionMdl).toBe(30); // 200 * 15%
    expect(s.netMdl).toBe(170);
  });

  it("uses the passed live pct (e.g. 40%) instead of the default", () => {
    const s = summarizeEarnings(orders, 40);
    expect(s.commissionMdl).toBe(80); // 200 * 40%
    expect(s.netMdl).toBe(120);
  });

  it("netForOrder tracks the same pct", () => {
    expect(netForOrder(orders[0])).toBe(85); // 100 - 15%
    expect(netForOrder(orders[0], 40)).toBe(60); // 100 - 40%
  });
});
