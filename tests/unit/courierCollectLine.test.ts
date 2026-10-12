import { describe, expect, it } from "vitest";
import { collectLine } from "@/components/courier/collectLine";

const o = (status: string, payment_method: string, payment_status: string) =>
  ({ status, payment_method, payment_status }) as Parameters<typeof collectLine>[0];

describe("collectLine — what the courier sees on the money row", () => {
  it("before delivery, cash and POS are still owed", () => {
    expect(collectLine(o("picked_up", "cash", "unpaid"))).toEqual({ label: "De încasat (cash)", owed: true });
    expect(collectLine(o("courier_assigned", "card_on_delivery", "unpaid"))).toEqual({ label: "De încasat (card POS)", owed: true });
  });
  it("after delivery it never says 'De încasat'", () => {
    expect(collectLine(o("delivered", "cash", "paid"))).toEqual({ label: "Încasat (cash)", owed: false });
    expect(collectLine(o("delivered", "cash", "unpaid"))).toEqual({ label: "Neîncasat (cash)", owed: false });
  });
  it("online payment: nothing to collect", () => {
    expect(collectLine(o("picked_up", "online_gateway", "paid")).owed).toBe(false);
    expect(collectLine(o("picked_up", "online_gateway", "paid")).label).toMatch(/online/i);
  });
  it("cancelled or rejected: nothing to collect", () => {
    expect(collectLine(o("cancelled", "cash", "unpaid")).owed).toBe(false);
    expect(collectLine(o("rejected", "cash", "unpaid")).owed).toBe(false);
  });
});
