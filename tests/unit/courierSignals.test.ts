import { describe, expect, it } from "vitest";
import {
  ISSUE_KIND_LABEL,
  ISSUE_LEG_LABEL,
  RELEASE_REASON_LABEL,
  currentVersion,
  distanceAssumedLabel,
  issueLabel,
  parseDailyCap,
  summarizeDistanceAssumed,
} from "@/lib/admin/courierSignals";
import { romanianRaiseText } from "@chisinau/shared-api";

// The DB check constraints are the source of truth (live \d on the three tables, 000205 / 000209).
const DB_ISSUE_KINDS = ["running_late", "restaurant_delayed", "venue_not_found", "customer_unreachable", "address_wrong"];
const DB_ISSUE_LEGS = ["pickup", "delivery"];
const DB_RELEASE_REASONS = ["vehicle_problem", "personal_emergency", "restaurant_delay", "other"];

describe("courier signal labels cover the DB check constraints", () => {
  it("every issue kind / leg / release reason has a Romanian label", () => {
    for (const k of DB_ISSUE_KINDS) expect(ISSUE_KIND_LABEL[k], k).toBeTruthy();
    for (const l of DB_ISSUE_LEGS) expect(ISSUE_LEG_LABEL[l], l).toBeTruthy();
    for (const r of DB_RELEASE_REASONS) expect(RELEASE_REASON_LABEL[r], r).toBeTruthy();
    expect(Object.keys(ISSUE_KIND_LABEL)).toHaveLength(DB_ISSUE_KINDS.length);
    expect(Object.keys(RELEASE_REASON_LABEL)).toHaveLength(DB_RELEASE_REASONS.length);
  });

  it("issueLabel composes kind + leg and never hides an unknown value", () => {
    expect(issueLabel("customer_unreachable", "delivery")).toBe("Clientul nu răspunde la livrare");
    expect(issueLabel("new_kind", "pickup")).toBe("new_kind la ridicare");
  });
});

describe("courier_fee_distance_assumed is tri-state", () => {
  it("true = presupus, false = măsurat, null/undefined = neevaluat (null ≠ false)", () => {
    expect(distanceAssumedLabel(true)).toBe("presupus");
    expect(distanceAssumedLabel(false)).toBe("măsurat");
    expect(distanceAssumedLabel(null)).toBe("neevaluat");
    expect(distanceAssumedLabel(undefined)).toBe("neevaluat");
    expect(distanceAssumedLabel(null)).not.toBe(distanceAssumedLabel(false));
  });

  it("summarizes a payout's orders by state, omitting empty buckets", () => {
    expect(summarizeDistanceAssumed([true, false, false, null])).toBe("1 presupuși · 2 măsurați · 1 neevaluați");
    expect(summarizeDistanceAssumed([false, false])).toBe("2 măsurați");
    expect(summarizeDistanceAssumed([])).toBe("—");
  });
});

describe("release policy", () => {
  it("parseDailyCap accepts integers 0..20 only; empty is null, not 0", () => {
    expect(parseDailyCap("3")).toBe(3);
    expect(parseDailyCap(" 0 ")).toBe(0);
    expect(parseDailyCap("20")).toBe(20);
    expect(parseDailyCap("")).toBeNull();
    expect(parseDailyCap("21")).toBeNull();
    expect(parseDailyCap("-1")).toBeNull();
    expect(parseDailyCap("2.5")).toBeNull();
    expect(parseDailyCap("abc")).toBeNull();
  });

  it("currentVersion picks the newest row that has already started (DB rule), none if all are future", () => {
    const rows = [
      { id: "future", effective_from: "2030-01-01T00:00:00Z" },
      { id: "cur", effective_from: "2026-01-01T00:00:00Z" },
      { id: "old", effective_from: "2025-01-01T00:00:00Z" },
    ];
    const now = Date.parse("2026-10-13T12:00:00Z");
    expect(currentVersion(rows, now)?.id).toBe("cur");
    expect(currentVersion(rows, Date.parse("2024-06-01T00:00:00Z"))).toBeNull();
  });

  it("the immutability trigger text is mapped to Romanian, never shown raw", () => {
    expect(romanianRaiseText("courier_release_policy is versioned: add a new row, never edit or delete one")).toBe(
      "Plafonul de renunțări nu se modifică pe loc — creează o versiune nouă.",
    );
  });
});
