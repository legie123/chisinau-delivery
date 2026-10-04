import { describe, expect, it, vi } from "vitest";
import { OFFER_POLL_BASE_MS, OFFER_POLL_JITTER_MS, nextPollDelay, startOfferPoll, type PollDeps } from "../src/lib/offerPoll";

// A fake clock: records every scheduled delay and lets the test fire timers.
function fakeDeps(randomValues: number[]) {
  const scheduled: { fn: () => void; ms: number; cleared: boolean }[] = [];
  let r = 0;
  const deps: PollDeps = {
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      scheduled.push(t);
      return t;
    },
    clearTimeout: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
    random: () => randomValues[r++ % randomValues.length],
  };
  const fireLast = async () => {
    const t = scheduled[scheduled.length - 1];
    t.fn();
    await new Promise((res) => setImmediate(res));
  };
  return { deps, scheduled, fireLast };
}

describe("offer poll scheduler", () => {
  it("polls every ~10s with jitter bounded to ±2s (never a fixed phase)", async () => {
    const { deps, scheduled, fireLast } = fakeDeps([0, 0.5, 0.9999]);
    const task = vi.fn(async () => {});
    startOfferPoll(task, deps);
    await fireLast();
    await fireLast();
    const delays = scheduled.map((s) => s.ms);
    expect(delays).toEqual([OFFER_POLL_BASE_MS - OFFER_POLL_JITTER_MS, OFFER_POLL_BASE_MS, OFFER_POLL_BASE_MS + OFFER_POLL_JITTER_MS]);
    expect(task).toHaveBeenCalledTimes(2);
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(8_000);
      expect(d).toBeLessThanOrEqual(12_000);
    }
  });

  it("a failed poll slows only the NEXT tick (≤ ~22s), then returns to base — an offer lives 30s", async () => {
    const { deps, scheduled, fireLast } = fakeDeps([0.5]);
    let fail = true;
    const task = vi.fn(async () => {
      if (fail) throw new Error("offline");
    });
    startOfferPoll(task, deps);
    await fireLast(); // fails
    await fireLast(); // fails again — must NOT grow further
    fail = false;
    await fireLast(); // succeeds
    expect(scheduled.map((s) => s.ms)).toEqual([10_000, 20_000, 20_000, 10_000]);
    expect(Math.max(...scheduled.map((s) => s.ms))).toBeLessThan(30_000);
  });

  it("stop() cancels the pending timer and no further tick runs", async () => {
    const { deps, scheduled } = fakeDeps([0.5]);
    const task = vi.fn(async () => {});
    const poll = startOfferPoll(task, deps);
    poll.stop();
    expect(scheduled[0].cleared).toBe(true);
    scheduled[0].fn(); // a timer that fires anyway after stop
    await new Promise((res) => setImmediate(res));
    expect(task).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
  });

  it("jitter is symmetric around the base", () => {
    expect(nextPollDelay(false, () => 0)).toBe(8_000);
    expect(nextPollDelay(false, () => 0.5)).toBe(10_000);
    expect(nextPollDelay(true, () => 0.5)).toBe(20_000);
  });
});
