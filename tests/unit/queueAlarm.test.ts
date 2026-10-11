import { describe, expect, it } from "vitest";
import { duePending, newArrivals, type PendingOrder } from "@/lib/kitchen/queueAlarm";

const now = Date.parse("2026-10-12T12:00:00Z");
const asap: PendingOrder = { id: "a", created_at: "2026-10-12T11:58:00Z", requested_for: null };
const soon: PendingOrder = { id: "s", created_at: "2026-10-12T09:00:00Z", requested_for: "2026-10-12T12:50:00Z" }; // window in 50 min
const later: PendingOrder = { id: "l", created_at: "2026-10-12T09:00:00Z", requested_for: "2026-10-22T19:35:00Z" };

describe("kitchen queue alarm", () => {
  it("rings for ASAP orders and for scheduled ones inside the 60-min lead, not for later ones", () => {
    expect(duePending([asap, soon, later], now).map((o) => o.id)).toEqual(["a", "s"]);
  });

  it("a scheduled order becomes due exactly 60 min before its window", () => {
    const edge = { ...later, requested_for: new Date(now + 60 * 60_000).toISOString() };
    expect(duePending([edge], now)).toHaveLength(1);
    expect(duePending([edge], now - 1)).toHaveLength(0);
  });

  it("new arrivals: nothing on first render, then only unseen ids", () => {
    expect(newArrivals([asap, later], null)).toEqual([]);
    expect(newArrivals([asap, later], new Set(["a"]))).toEqual(["l"]);
  });
});
