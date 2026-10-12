// Parity row 12: after the restaurant accepted, the customer can report a problem from the app
// (customer_report_problem, sim 112). Before acceptance the order is cancelled instead.
import { describe, expect, it } from "vitest";
import { PROBLEM_KINDS, customerCanCancel, customerCanReport } from "../src/lib/orderStatus";

describe("customerCanReport", () => {
  it("never while pending (cancel instead); every state after acceptance", () => {
    expect(customerCanReport("pending_restaurant")).toBe(false);
    expect(customerCanCancel("pending_restaurant")).toBe(true);
    for (const s of ["accepted", "ready_for_pickup", "courier_assigned", "picked_up", "en_route", "delivered", "cancelled", "rejected"]) {
      expect(customerCanReport(s)).toBe(true);
    }
    expect(customerCanReport("not-a-status")).toBe(false);
  });

  it("offers exactly the kinds the server accepts, in Romanian", () => {
    expect(PROBLEM_KINDS.map((k) => k.key)).toEqual(["missing_item", "wrong_item", "late", "quality", "courier", "other"]);
    expect(PROBLEM_KINDS.every((k) => /[a-zăâîșț]/i.test(k.label))).toBe(true);
  });
});
