import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pickupCode } from "../src/lib/orderView";

const src = (f: string) => readFileSync(path.join(path.resolve(__dirname, ".."), f), "utf8");

// Consumer-side test of RESTAURANT's handover rule (CROSS-REQUESTS 2026-10-12): the kitchen tablet shows
// "Cod ridicare: NNN" = last 3 digits of order_number and hands the bag over only on a match.
describe("pickupCode — same rule as the kitchen tablet", () => {
  it("last 3 digits of CHD-YYYY-NNNNNN", () => {
    expect(pickupCode("CHD-2026-000123")).toBe("123");
    expect(pickupCode("CHD-2026-104507")).toBe("507");
    expect(pickupCode(" CHD-2026-000009 ")).toBe("009");
  });
  it("no trailing digits -> null (never an invented code)", () => {
    expect(pickupCode("CHD-2026-")).toBeNull();
    expect(pickupCode("")).toBeNull();
  });
});

describe("wiring: shown big on the pickup leg, before 'Am ridicat'", () => {
  it("the order carries its number and ActiveDeliveryScreen renders the code only while picking up", () => {
    expect(src("src/lib/api.ts")).toMatch(/orderNumber: r\.order_number,/);
    const s = src("src/screens/ActiveDeliveryScreen.tsx");
    expect(s).toMatch(/status === 'pickup' && pickupCode\(order\.orderNumber\)/);
    expect(s).toMatch(/Cod ridicare/);
  });
  it("the web courier page shows the same code from the same rule (copy, not an import across mobile/ <-> src/)", () => {
    const web = readFileSync(path.resolve(__dirname, "../../../src/components/courier/pickupCode.ts"), "utf8");
    const app = src("src/lib/orderView.ts");
    const rule = /\/\(\\d\{3\}\)\$\/\.exec\(orderNumber\.trim\(\)\)/;
    expect(web).toMatch(rule);
    expect(app).toMatch(rule);
    const page = readFileSync(path.resolve(__dirname, "../../../src/app/(courier)/deliveries/[deliveryId]/page.tsx"), "utf8");
    expect(page).toMatch(/typedOrder\.status === "courier_assigned" && pickupCode\(typedOrder\.order_number\) && \(/);
  });
});
