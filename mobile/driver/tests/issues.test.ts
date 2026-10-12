import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ISSUE_LABELS, issueKindsFor, issueReportedText } from "../src/lib/issues";

const src = (f: string) => readFileSync(path.join(path.resolve(__dirname, ".."), f), "utf8");

describe("issueKindsFor (mirrors the leg rule in courier_report_issue)", () => {
  it("before pickup: running late, order not ready, can't find the restaurant — never a customer problem", () => {
    expect(issueKindsFor("pickup")).toEqual(["running_late", "restaurant_delayed", "venue_not_found"]);
  });
  it("after pickup: running late, customer unreachable, wrong address — never a restaurant problem", () => {
    expect(issueKindsFor("delivering")).toEqual(["running_late", "customer_unreachable", "address_wrong"]);
  });
  it("a finished delivery offers nothing to report", () => {
    expect(issueKindsFor("delivered")).toEqual([]);
  });
  it("every kind has a Romanian label", () => {
    for (const k of [...issueKindsFor("pickup"), ...issueKindsFor("delivering")]) {
      expect(ISSUE_LABELS[k]).toMatch(/[a-zăâîșț]/i);
    }
  });
});

describe("issueReportedText", () => {
  it("a first report and a repeat read differently (the RPC returns false on a repeat)", () => {
    expect(issueReportedText(true)).not.toEqual(issueReportedText(false));
    expect(issueReportedText(false)).toMatch(/deja/);
  });
});

describe("wiring: the delivery screen really files the report", () => {
  it("api.ts calls the typed shared-api wrapper", () => {
    expect(src("src/lib/api.ts")).toMatch(/reportDeliveryIssue\(supabase, orderId as OrderId, kind\)/);
  });
  it("ActiveDeliveryScreen lists issueKindsFor(status) and sends the chosen kind through reportIssue", () => {
    const s = src("src/screens/ActiveDeliveryScreen.tsx");
    expect(s).toMatch(/issueKindsFor\(status\)\.map\(/);
    expect(s).toMatch(/reportIssue\(order\.id, kind\)/);
    expect(s).toMatch(/Raportează o problemă/);
  });
});
