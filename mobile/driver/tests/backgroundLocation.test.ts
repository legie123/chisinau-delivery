import { beforeEach, describe, expect, it, vi } from "vitest";

// The REAL background GPS task (src/lib/backgroundLocation.ts) with the native
// modules faked: expo-task-manager hands us the task body, expo-location is a
// spy, Supabase is a fake channel + a fake `orders` row.
const h = vi.hoisted(() => {
  const store = new Map<string, string>();
  const state = {
    task: null as null | ((body: { data: unknown; error: { message: string } | null }) => Promise<void>),
    started: false,
    hasStartedThrows: false,
    order: { status: "en_route", courier_id: "c1" } as { status: string; courier_id: string } | null,
    orderReadFails: false,
    orderGate: null as Promise<void> | null, // holds the orders read in flight
    queue: [] as { orderId: string; newStatus: string }[],
    channels: [] as { name: string; sends: unknown[]; onStatus: ((s: string) => void) | null; removed: boolean }[],
    upserts: [] as unknown[],
  };
  return { store, state };
});

vi.mock("expo-task-manager", () => ({
  defineTask: (_name: string, fn: typeof h.state.task) => {
    h.state.task = fn;
  },
}));

vi.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  ActivityType: { OtherNavigation: 4 },
  requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
  requestBackgroundPermissionsAsync: async () => ({ status: "granted" }),
  hasStartedLocationUpdatesAsync: vi.fn(async () => {
    if (h.state.hasStartedThrows) throw new Error("TaskManager not ready");
    return h.state.started;
  }),
  startLocationUpdatesAsync: vi.fn(async () => {
    h.state.started = true;
  }),
  stopLocationUpdatesAsync: vi.fn(async () => {
    h.state.started = false;
  }),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => h.store.get(k) ?? null,
    setItem: async (k: string, v: string) => void h.store.set(k, v),
    removeItem: async (k: string) => void h.store.delete(k),
  },
}));

vi.mock("../src/lib/offlineQueue", () => ({ statusQueue: { read: async () => h.state.queue } }));

vi.mock("../src/lib/supabase", () => {
  const ordersQuery = {
    select: () => ordersQuery,
    eq: () => ordersQuery,
    maybeSingle: async () => {
      await h.state.orderGate;
      return h.state.orderReadFails
        ? { data: null, error: { message: "TypeError: Network request failed" } }
        : { data: h.state.order, error: null };
    },
  };
  return {
    supabase: {
      realtime: { setAuth: async () => undefined },
      channel: (name: string) => {
        const c = { name, sends: [] as unknown[], onStatus: null as ((s: string) => void) | null, removed: false };
        h.state.channels.push(c);
        return {
          subscribe(cb?: (s: string) => void) {
            c.onStatus = cb ?? null;
            return this;
          },
          send: async (msg: unknown) => {
            c.sends.push(msg);
            return "ok";
          },
          _c: c,
        };
      },
      removeChannel: async (ch: { _c: { removed: boolean } }) => {
        ch._c.removed = true;
      },
      from: (table: string) =>
        table === "orders"
          ? ordersQuery
          : { upsert: async (row: unknown) => (h.state.upserts.push(row), { error: null }) },
    },
  };
});

const Location = await import("expo-location");
const gps = await import("../src/lib/backgroundLocation");

const fix = (lat: number) => ({
  data: { locations: [{ coords: { latitude: lat, longitude: 28.86, accuracy: 5 } }] },
  error: null,
});
const sentPoints = () => h.state.channels.flatMap((c) => c.sends.map((s) => (s as { payload: { lat: number } }).payload.lat));

beforeEach(async () => {
  await gps.stopDeliveryTracking(); // resets the module's channel/status memory
  vi.clearAllMocks();
  h.store.clear();
  Object.assign(h.state, {
    started: false,
    hasStartedThrows: false,
    order: { status: "en_route", courier_id: "c1" },
    orderReadFails: false,
    orderGate: null,
    queue: [],
    channels: [],
    upserts: [],
  });
});

describe("first fix is not lost (LOW: send before the private channel joined)", () => {
  it("keeps the latest point until SUBSCRIBED, then sends it", async () => {
    await gps.startDeliveryTracking("o1", "c1");
    await h.state.task!(fix(47.01));
    await h.state.task!(fix(47.02));
    expect(sentPoints()).toEqual([]); // nothing went out over the REST fallback

    h.state.channels[0].onStatus!("SUBSCRIBED");
    expect(sentPoints()).toEqual([47.02]); // only the latest
    await h.state.task!(fix(47.03));
    expect(sentPoints()).toEqual([47.02, 47.03]);
  });
});

describe("GPS privacy: positions only during picked_up / en_route (MED)", () => {
  it("accepted but not picked up (courier_assigned): no customer channel, only the courier_locations row the restaurant's pickup map reads (MED regression)", async () => {
    h.state.order = { status: "courier_assigned", courier_id: "c1" };
    await gps.startDeliveryTracking("o1", "c1");
    await h.state.task!(fix(47.01));
    expect(h.state.channels).toEqual([]); // order:o1:location never even joined
    // RLS: courier_locations is the restaurant's in courier_assigned, the customer's only from picked_up.
    // At once, not 45s after the previous delivery's last row (the stale marker the kitchen saw).
    expect(h.state.upserts).toEqual([{ courier_id: "c1", lat: 47.01, lng: 28.86, accuracy_m: 5 }]);
    expect(h.state.started).toBe(true);
    expect(await gps.trackedOrderId()).toBe("o1");
  });

  it("order delivered/cancelled elsewhere (UI dead, service alive): stops on the next fix", async () => {
    for (const status of ["delivered", "cancelled"]) {
      h.state.order = { status, courier_id: "c1" };
      await gps.startDeliveryTracking("o1", "c1");
      await h.state.task!(fix(47.01));
      expect(h.state.started).toBe(false);
    }
    expect(sentPoints()).toEqual([]);
  });

  it("order reassigned to another courier: stops", async () => {
    h.state.order = { status: "en_route", courier_id: "someone-else" };
    await gps.startDeliveryTracking("o1", "c1");
    await h.state.task!(fix(47.01));
    expect(h.state.started).toBe(false);
    expect(sentPoints()).toEqual([]);
  });

  it("'delivered' still in the offline queue: stops even though the server says en_route", async () => {
    h.state.queue = [{ orderId: "o1", newStatus: "delivered" }];
    await gps.startDeliveryTracking("o1", "c1");
    await h.state.task!(fix(47.01));
    expect(h.state.started).toBe(false);
    expect(sentPoints()).toEqual([]);
  });

  it("pickup swiped offline (queued en_route, server still courier_assigned): holds, sends once the server confirms", async () => {
    h.state.order = { status: "courier_assigned", courier_id: "c1" };
    h.state.queue = [{ orderId: "o1", newStatus: "en_route" }];
    await gps.startDeliveryTracking("o1", "c1");
    await h.state.task!(fix(47.01));
    expect(h.state.started).toBe(true);
    expect(sentPoints()).toEqual([]);

    h.state.order = { status: "en_route", courier_id: "c1" };
    h.state.queue = [];
    await h.state.task!(fix(47.02));
    h.state.channels[0].onStatus!("SUBSCRIBED");
    expect(sentPoints()).toEqual([47.02]);
  });

  it("no signal and status never confirmed: holds (no send, no stop)", async () => {
    h.state.orderReadFails = true;
    await gps.startDeliveryTracking("o1", "c1");
    await h.state.task!(fix(47.01));
    expect(h.state.started).toBe(true);
    expect(sentPoints()).toEqual([]);
  });
});

describe("a fix in flight while tracking stops is not sent after the stop (LOW)", () => {
  it("the tick resumes after stopDeliveryTracking: no point to the customer, no channel left open", async () => {
    await gps.startDeliveryTracking("o1", "c1");
    let release!: () => void;
    h.state.orderGate = new Promise<void>((r) => (release = r));
    const tick = h.state.task!(fix(47.01)); // has read the tracked order, waits on the orders read
    await gps.stopDeliveryTracking(); // "am livrat" / closeWith
    release();
    await tick;
    for (const c of h.state.channels) c.onStatus?.("SUBSCRIBED");
    expect(sentPoints()).toEqual([]);
    expect(h.state.channels.filter((c) => !c.removed)).toEqual([]);
  });
});

describe("Android start refused in the background is retried (LOW)", () => {
  it("resumeDeliveryTracking re-arms a recorded delivery whose updates are not running", async () => {
    vi.mocked(Location.startLocationUpdatesAsync).mockRejectedValueOnce(new Error("ForegroundServiceStartNotAllowedException"));
    await expect(gps.startDeliveryTracking("o1", "c1")).rejects.toThrow();
    expect(h.state.started).toBe(false);

    const resume = (gps as Record<string, unknown>).resumeDeliveryTracking as () => Promise<string | null>;
    expect(typeof resume).toBe("function");
    await resume(); // app back in the foreground
    expect(h.state.started).toBe(true);
    expect(await gps.trackedOrderId()).toBe("o1");
  });
});

describe("stopDeliveryTracking never silently leaves GPS on (LOW c)", () => {
  it("a failing 'has started?' check still stops the updates", async () => {
    await gps.startDeliveryTracking("o1", "c1");
    h.state.hasStartedThrows = true;
    await gps.stopDeliveryTracking();
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
    expect(h.state.started).toBe(false);
  });
});
