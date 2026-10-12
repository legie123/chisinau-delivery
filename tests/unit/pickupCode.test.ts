import { describe, expect, it } from "vitest";
import { pickupCode } from "@/lib/kitchen/pickupCode";

describe("pickupCode", () => {
  it("is the last 3 digits of the order number", () => {
    expect(pickupCode("CHD-2026-040576")).toBe("576");
    expect(pickupCode("CHD-2026-000007")).toBe("007");
  });
  it("is null when the number doesn't end in digits (never an invented code)", () => {
    expect(pickupCode("CHD-2026-ABC")).toBeNull();
  });
});
