// @vitest-environment node
// @chisinau/shared-domain must run where there is no browser (React Native, Node).
// This file imports it in plain node with NO stubbed globals: if any module in the
// package touched a browser global at import or call time, this fails.
import { describe, expect, it, vi } from "vitest";
import {
  createStatusQueue,
  netForOrder,
  quotedNetMdl,
  trailingThrottle,
  isOpenNow,
  formatPrepRange,
  type KeyValueStorage,
} from "@chisinau/shared-domain";

// AsyncStorage-shaped: every method returns a Promise, like the native store.
function asyncMemoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

describe("@chisinau/shared-domain — browser-free in plain node", () => {
  it("runs with no browser globals present", () => {
    expect(typeof (globalThis as Record<string, unknown>).window).toBe("undefined");
    expect(typeof (globalThis as Record<string, unknown>).document).toBe("undefined");
    expect(typeof (globalThis as Record<string, unknown>).localStorage).toBe("undefined");
  });

  it("earnings: net = fee + tip - commission on fee; unpaid is null, never a number", () => {
    expect(netForOrder({ delivery_fee_mdl: 50, tip_mdl: 10, payment_status: "paid" }, 20)).toBe(50);
    expect(netForOrder({ delivery_fee_mdl: 50, tip_mdl: 10, payment_status: "pending" }, 20)).toBeNull();
    expect(quotedNetMdl({ courier_fee_quoted_mdl: 40, delivery_fee_mdl: 30 }, 15)).toBe(34);
  });

  it("status queue works over an injected ASYNC storage + injected RPC caller", async () => {
    const store = asyncMemoryStorage();
    const q = createStatusQueue(store);
    await q.enqueue({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    await q.enqueue({ orderId: "o2", newStatus: "en_route", ts: 2 });
    expect(await q.count()).toBe(2);
    expect(store.map.size).toBe(1); // persisted through the injected storage, not a global

    const advance = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockRejectedValueOnce(new TypeError("Network request failed")); // RN fetch wording
    await q.drain(advance);
    expect(advance).toHaveBeenCalledWith("o1", "picked_up", undefined);
    expect(await q.hasPending("o1")).toBe(false);
    expect(await q.hasPending("o2")).toBe(true);
  });

  it("trailingThrottle and the pure order helpers need no DOM", () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const t = trailingThrottle((v: number) => sent.push(v), 1000);
    t.push(1);
    t.push(2);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([1, 2]);
    vi.useRealTimers();

    expect(formatPrepRange(25)).toBe("25–40 min");
    expect(
      isOpenNow([{ restaurant_id: "r", day_of_week: 1, opens_at: "10:00:00", closes_at: "22:00:00", is_closed: false }], 1, "12:00:00"),
    ).toBe(true);
  });
});
