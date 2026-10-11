import { describe, expect, it } from "vitest";
import { HEARTBEAT_MS, heartbeatDue } from "../src/lib/heartbeat";

const base = { online: true, delivering: false, hasFix: true, lastAt: 0, now: 100_000 };

describe("heartbeatDue", () => {
  it("sends when online, idle, with a fix, and the last send is older than the interval", () => {
    expect(heartbeatDue(base)).toBe(true);
  });
  it("waits inside the interval", () => {
    expect(heartbeatDue({ ...base, lastAt: base.now - HEARTBEAT_MS + 1 })).toBe(false);
    expect(heartbeatDue({ ...base, lastAt: base.now - HEARTBEAT_MS })).toBe(true);
  });
  it("never sends offline: an offline courier's position is nobody's business", () => {
    expect(heartbeatDue({ ...base, online: false })).toBe(false);
  });
  it("leaves active deliveries to the background task", () => {
    expect(heartbeatDue({ ...base, delivering: true })).toBe(false);
  });
  it("needs a real fix", () => {
    expect(heartbeatDue({ ...base, hasFix: false })).toBe(false);
  });
  it("keeps the position fresh inside the 2-minute dispatch window", () => {
    expect(HEARTBEAT_MS).toBeLessThan(120_000 / 2);
  });
});
