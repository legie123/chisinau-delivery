import { beforeEach, describe, expect, it, vi } from "vitest";

// localStorage stub for node — same pattern as tests/unit/cart.test.ts.
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
});

const {
  readPendingQueue,
  enqueueStatusChange,
  hasPendingChange,
  pendingQueueCount,
  drainPendingQueue,
  isNetworkError,
  giveUpCount,
  clearGiveUpCount,
} = await import("@/lib/offline/statusQueue");

describe("offline courier status queue — comanda nu se pierde fără semnal", () => {
  beforeEach(() => {
    storage.clear();
  });

  it("enqueues an entry and reports it pending", () => {
    enqueueStatusChange({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    expect(hasPendingChange("o1")).toBe(true);
    expect(readPendingQueue()).toHaveLength(1);
  });

  it("a newer tap for the same order supersedes the older one", () => {
    enqueueStatusChange({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    enqueueStatusChange({ orderId: "o1", newStatus: "en_route", ts: 2 });
    const queue = readPendingQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].newStatus).toBe("en_route");
  });

  it("drain removes an entry that the RPC accepts", async () => {
    enqueueStatusChange({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    const advance = vi.fn().mockResolvedValue({ error: null });
    await drainPendingQueue(advance);
    expect(advance).toHaveBeenCalledWith("o1", "picked_up", undefined);
    expect(hasPendingChange("o1")).toBe(false);
  });

  it("drain drops an entry the RPC rejects as an invalid transition", async () => {
    enqueueStatusChange({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    const advance = vi.fn().mockResolvedValue({ error: "invalid transition delivered -> picked_up" });
    await drainPendingQueue(advance);
    expect(hasPendingChange("o1")).toBe(false);
  });

  it("drain keeps an entry that still fails over the network", async () => {
    enqueueStatusChange({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    const advance = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await drainPendingQueue(advance);
    expect(hasPendingChange("o1")).toBe(true);
  });

  it("drain keeps an entry on an unrelated business error (not invalid-transition)", async () => {
    enqueueStatusChange({ orderId: "o1", newStatus: "delivered", ts: 1 });
    const advance = vi.fn().mockResolvedValue({ error: "online order cannot be delivered before payment is confirmed" });
    await drainPendingQueue(advance);
    expect(hasPendingChange("o1")).toBe(true);
  });

  it("drain processes multiple orders independently", async () => {
    enqueueStatusChange({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    enqueueStatusChange({ orderId: "o2", newStatus: "en_route", ts: 2 });
    const advance = vi.fn().mockResolvedValue({ error: null });
    await drainPendingQueue(advance);
    expect(advance).toHaveBeenCalledTimes(2);
    expect(readPendingQueue()).toHaveLength(0);
  });

  it("pendingQueueCount reflects the app-level banner count and clears after a full drain", async () => {
    expect(pendingQueueCount()).toBe(0);
    enqueueStatusChange({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    enqueueStatusChange({ orderId: "o2", newStatus: "en_route", ts: 2 });
    expect(pendingQueueCount()).toBe(2); // banner would show "2 acțiuni în așteptare"

    const advance = vi.fn().mockResolvedValue({ error: null });
    await drainPendingQueue(advance);
    expect(pendingQueueCount()).toBe(0); // drained → banner hides, router.refresh() fires
  });

  it("pendingQueueCount keeps counting entries stuck offline (banner stays up)", async () => {
    enqueueStatusChange({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    const advance = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await drainPendingQueue(advance);
    expect(pendingQueueCount()).toBe(1); // still offline → banner remains
  });

  it("isNetworkError recognizes fetch-level failures", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("network error"))).toBe(true);
    expect(isNetworkError(new Error("invalid transition picked_up -> delivered"))).toBe(false);
  });

  it("drops an entry once it hits the max attempt cap and counts it as given up", async () => {
    enqueueStatusChange({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    const advance = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    // 8 failed attempts bring the counter to the cap; the 9th drain sees the
    // cap already hit and gives up without calling `advance` again.
    for (let i = 0; i < 8; i++) {
      await drainPendingQueue(advance);
    }
    expect(hasPendingChange("o1")).toBe(true);
    expect(advance).toHaveBeenCalledTimes(8);

    await drainPendingQueue(advance);
    expect(advance).toHaveBeenCalledTimes(8); // no extra attempt — already at the cap
    expect(hasPendingChange("o1")).toBe(false);
    expect(giveUpCount()).toBe(1);
    clearGiveUpCount();
  });

  it("drops an entry older than 24h without retrying it, and counts it as given up", async () => {
    enqueueStatusChange({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    // Backdate enqueuedAt past the 24h budget directly in storage.
    const queue = readPendingQueue();
    queue[0].enqueuedAt = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem("chisinau-courier-pending-status", JSON.stringify(queue));

    const advance = vi.fn().mockResolvedValue({ error: null });
    await drainPendingQueue(advance);

    expect(advance).not.toHaveBeenCalled();
    expect(hasPendingChange("o1")).toBe(false);
    expect(giveUpCount()).toBe(1);
    clearGiveUpCount();
  });

  it("clearGiveUpCount dismisses the stuck-entry banner", () => {
    expect(giveUpCount()).toBe(0);
    clearGiveUpCount(); // no-op when already zero, shouldn't throw
    expect(giveUpCount()).toBe(0);
  });
});
