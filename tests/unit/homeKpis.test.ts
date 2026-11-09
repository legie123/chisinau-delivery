import { describe, expect, it } from "vitest";
import { weekGrossMdl, ratingLabel } from "@/lib/kitchen/homeKpis";

describe("weekGrossMdl", () => {
  it("standard → subtotal; catering → total − fee − tip (clamped at 0); rounded once at the end", () => {
    expect(
      weekGrossMdl([
        { order_type: "standard", subtotal_mdl: 120.005, total_mdl: 160, delivery_fee_mdl: 40, tip_mdl: 0 },
        { order_type: "catering", subtotal_mdl: 0, total_mdl: 1000, delivery_fee_mdl: 50, tip_mdl: null },
        { order_type: "catering", subtotal_mdl: 0, total_mdl: 10, delivery_fee_mdl: 50, tip_mdl: 5 },
      ]),
    ).toBe(1070.01);
  });
  it("empty → 0", () => {
    expect(weekGrossMdl([])).toBe(0);
  });
});

describe("ratingLabel", () => {
  it("no ratings yet → em dash, never a fake 0", () => {
    expect(ratingLabel(null, 0)).toEqual({ value: "—", hint: "nicio evaluare încă" });
  });
  it("avg ★ + count in Romanian", () => {
    expect(ratingLabel(4.97, 31)).toEqual({ value: "4.97 ★", hint: "din 31 evaluări" });
    expect(ratingLabel(5, 1)).toEqual({ value: "5.00 ★", hint: "din 1 evaluare" });
  });
});
