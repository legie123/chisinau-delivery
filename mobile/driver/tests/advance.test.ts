import { describe, expect, it } from "vitest";
import { canAdvance } from "@chisinau/shared-types";
import { createStatusQueue, type KeyValueStorage } from "@chisinau/shared-domain";
import { advanceThrough, makeQueueAdvance } from "../src/lib/advance";

// A fake Supabase that behaves like advance_delivery_status: validates the hop
// against the real transition map, raises "invalid transition" otherwise, and
// can drop off the network.
function fakeDb(initial: string) {
  // visible=false: RLS hides the row (reassigned to another courier — or, with session=false, a
  // lapsed session whose request went out with the anon key).
  const state = { status: initial, offline: false, visible: true, session: true, hops: [] as { to: string; paid: unknown }[] };
  const networkError = { message: "TypeError: Network request failed", code: "", details: "", hint: "" };
  const zeroRows = { message: "Cannot coerce the result to a single JSON object", code: "PGRST116", details: "The result contains 0 rows", hint: "" };
  const row = () => (state.visible ? { status: state.status } : null);
  const db = {
    auth: { getSession: async () => ({ data: { session: state.session ? { user: { id: "k" } } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            state.offline ? { data: null, error: networkError } : row() ? { data: row(), error: null } : { data: null, error: zeroRows },
          maybeSingle: async () => (state.offline ? { data: null, error: networkError } : { data: row(), error: null }),
        }),
      }),
    }),
    rpc: async (_fn: string, args: { p_new_status: string; p_payment_confirmed?: boolean }) => {
      if (state.offline) return { error: networkError };
      const to = args.p_new_status;
      if (to === state.status) return { error: null }; // idempotent same-status retry
      if (!canAdvance(state.status as never, to as never)) {
        return { error: { code: "P0001", message: `invalid transition ${state.status} -> ${to}`, details: "", hint: "" } };
      }
      state.hops.push({ to, paid: args.p_payment_confirmed });
      state.status = to;
      return { error: null };
    },
  };
  return { db: db as never, state };
}

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
    removeItem: async (k) => {
      m.delete(k);
    },
  };
}

describe("advanceThrough — target status, every hop walked", () => {
  it("pickup swipe (target en_route) from courier_assigned walks picked_up → en_route", async () => {
    const { db, state } = fakeDb("courier_assigned");
    await advanceThrough(db, "o1", "en_route");
    expect(state.hops.map((h) => h.to)).toEqual(["picked_up", "en_route"]);
  });

  it("payment confirmation travels only on the delivered hop", async () => {
    const { db, state } = fakeDb("picked_up");
    await advanceThrough(db, "o1", "delivered", true);
    expect(state.hops).toEqual([
      { to: "en_route", paid: undefined },
      { to: "delivered", paid: true },
    ]);
  });

  it("an unreachable target (order cancelled meanwhile) is an 'invalid transition', not a crash", async () => {
    const { db } = fakeDb("cancelled");
    await expect(advanceThrough(db, "o1", "delivered", true)).rejects.toThrow(/invalid transition cancelled -> delivered/);
  });
});

describe("offline queue replay (BLOCKER: 'pickup + deliver in a dead zone' must not vanish)", () => {
  it("both taps offline → reconnect → order ends DELIVERED with every hop sent", async () => {
    const { db, state } = fakeDb("courier_assigned");
    const queue = createStatusQueue(memoryStorage());
    const advance = makeQueueAdvance(db);

    state.offline = true;
    // tap 1: "am ridicat" (target en_route), tap 2: "am livrat" — the queue keeps
    // ONE entry per order, so only the delivered intent survives.
    await queue.enqueue({ orderId: "o1", newStatus: "en_route", ts: 1 });
    await queue.enqueue({ orderId: "o1", newStatus: "delivered", paymentConfirmed: true, ts: 2 });
    await queue.drain(advance); // still offline: kept
    expect(await queue.count()).toBe(1);
    expect(state.status).toBe("courier_assigned");

    state.offline = false;
    await queue.drain(advance);
    expect(state.status).toBe("delivered");
    expect(state.hops.map((h) => h.to)).toEqual(["picked_up", "en_route", "delivered"]);
    expect(await queue.count()).toBe(0);
    expect(await queue.giveUpCount()).toBe(0);
  });

  it("an entry the order already moved past is dropped, not retried forever", async () => {
    const { db } = fakeDb("delivered");
    const queue = createStatusQueue(memoryStorage());
    await queue.enqueue({ orderId: "o1", newStatus: "en_route", ts: 1 });
    await queue.drain(makeQueueAdvance(db));
    expect(await queue.count()).toBe(0);
  });

  it("an entry for an order reassigned to another courier is dropped at once, not retried 8 times", async () => {
    const { db, state } = fakeDb("en_route");
    state.visible = false;
    const queue = createStatusQueue(memoryStorage());
    await queue.enqueue({ orderId: "o1", newStatus: "delivered", paymentConfirmed: true, ts: 1 });
    await queue.drain(makeQueueAdvance(db));
    expect(await queue.count()).toBe(0);
    expect(state.hops).toEqual([]);
  });

  it("a LAPSED session (anon key, row hidden) keeps 'am livrat' queued — it is not a reassignment", async () => {
    // Token expired while offline and the refresh failed: supabase-js sends the anon key, RLS
    // returns no row. e35e10d read that as "reassigned" and dropped the tap with no banner.
    const { db, state } = fakeDb("en_route");
    state.visible = false;
    state.session = false;
    const queue = createStatusQueue(memoryStorage());
    await queue.enqueue({ orderId: "o1", newStatus: "delivered", paymentConfirmed: true, ts: 1 });
    await queue.drain(makeQueueAdvance(db));
    expect(await queue.count()).toBe(1);
    expect(await queue.giveUpCount()).toBe(0);

    state.visible = true;
    state.session = true; // refresh succeeded
    await queue.drain(makeQueueAdvance(db));
    expect(state.status).toBe("delivered");
    expect(await queue.count()).toBe(0);
  });
});
