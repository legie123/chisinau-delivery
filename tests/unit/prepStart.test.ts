import { describe, expect, it } from "vitest";
import { prepStartAt, startsDue, type StartCandidate } from "@/lib/kitchen/prepStart";

const now = Date.parse("2026-10-12T12:00:00Z");
const sched: StartCandidate = {
  id: "s",
  status: "accepted",
  requested_for: "2026-10-12T13:30:00Z",
  estimated_ready_at: "2026-10-12T12:45:00Z", // requested_for − 45 min
  prep_time_override_minutes: null,
};

describe("prep start for scheduled orders", () => {
  it("is the ready time minus the prep minutes (override wins over the venue estimate)", () => {
    expect(prepStartAt(sched, 35)).toBe(Date.parse("2026-10-12T12:10:00Z"));
    expect(prepStartAt({ ...sched, prep_time_override_minutes: 50 }, 35)).toBe(Date.parse("2026-10-12T11:55:00Z"));
  });
  it("is null for ASAP, not-yet-accepted or unstamped orders", () => {
    expect(prepStartAt({ ...sched, requested_for: null }, 35)).toBeNull();
    expect(prepStartAt({ ...sched, status: "pending_restaurant" }, 35)).toBeNull();
    expect(prepStartAt({ ...sched, estimated_ready_at: null }, 35)).toBeNull();
  });
  it("rings once when the start time comes", () => {
    expect(startsDue([sched], 35, now, new Set())).toEqual([]); // 12:10 not yet
    expect(startsDue([sched], 35, now + 10 * 60_000, new Set())).toEqual(["s"]);
    expect(startsDue([sched], 35, now + 10 * 60_000, new Set(["s"]))).toEqual([]);
  });
});
