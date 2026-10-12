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
    session: true, // false = the session lapsed: the client refuses the read (src/lib/supabase.ts)
    orderGate: null as Promise<void> | null, // holds the orders read in flight
    platform: { OS: "android" as "android" | "ios" },
    options: null as null | { timeInterval: number; distanceInterval: number },
    queue: [] as { orderId: string; newStatus: string }[],
    channels: [] as { name: string; sends: unknown[]; onStatus: ((s: string) => void) | null; removed: boolean }[],
    upserts: [] as unknown[],
    bgStatus: "denied" as "granted" | "denied",
    bgRequests: 0,
  };
  return { store, state };
});

vi.mock("react-native", () => ({ Platform: h.state.platform }));

vi.mock("expo-task-manager", () => ({
  defineTask: (_name: string, fn: typeof h.state.task) => {
    h.state.task = fn;
  },
}));

vi.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  ActivityType: { OtherNavigation: 4 },
  requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
  getBackgroundPermissionsAsync: async () => ({ status: h.state.bgStatus }),
  requestBackgroundPermissionsAsync: async () => {
    h.state.bgRequests += 1;
    h.state.bgStatus = "granted";
    return { status: "granted" };
  },
  hasStartedLocationUpdatesAsync: vi.fn(async () => {
    if (h.state.hasStartedThrows) throw new Error("TaskManager not ready");
    return h.state.started;
  }),
  startLocationUpdatesAsync: vi.fn(async (_task: string, options: typeof h.state.options) => {
    h.state.started = true;
    h.state.options = options;
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
      if (h.state.orderReadFails) return { data: null, error: { message: "TypeError: Network request failed" } };
      if (!h.state.session) return { data: null, error: { message: "network: no courier session" } };
      return { data: h.state.order, error: null };
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
    session: true,
    orderGate: null,
    options: null,
    queue: [],
    channels: [],
    upserts: [],
  });
  h.state.platform.OS = "android";
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

  it("row hidden with a live session (reassigned, RLS): stops", async () => {
    h.state.order = null;
    await gps.startDeliveryTracking("o1", "c1");
    await h.state.task!(fix(47.01));
    expect(h.state.started).toBe(false);
  });

  it("the session LAPSED (the read is refused, not answered with no row): keeps tracking, sends nothing, does not stop", async () => {
    h.state.order = null;
    h.state.session = false;
    await gps.startDeliveryTracking("o1", "c1");
    await h.state.task!(fix(47.01));
    expect(h.state.started).toBe(true);
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

describe("a courier waiting at the pickup stays on the restaurant's map (LOW: 2-min RLS bound, 20261004000700)", () => {
  // The OS side, as expo-location 19 configures it: a fix every timeInterval, dropped when the phone
  // moved less than distanceInterval since the last one delivered (Android setMinUpdateDistanceMeters).
  async function standStill(ms: number) {
    const { timeInterval, distanceInterval } = h.state.options!;
    const t0 = Date.now();
    let now = t0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const upsertAt: number[] = [];
    try {
      for (let delivered = 0; now - t0 <= ms; now += timeInterval) {
        const moved = delivered === 0 ? Infinity : 0; // same spot at the restaurant's door
        if (moved < distanceInterval) continue;
        delivered += 1;
        const before = h.state.upserts.length;
        await h.state.task!(fix(47.01));
        if (h.state.upserts.length > before) upsertAt.push(now);
      }
      return { upsertAt, end: now - timeInterval, t0 };
    } finally {
      clock.mockRestore();
    }
  }

  it("Android: 2 min standing still, the courier_locations row is never older than ~50 s", async () => {
    h.state.order = { status: "courier_assigned", courier_id: "c1" };
    await gps.startDeliveryTracking("o1", "c1");
    const { upsertAt, end } = await standStill(120_000);
    expect(upsertAt.length).toBeGreaterThanOrEqual(3); // was 1: the 25 m filter delivered no fix after it
    expect(end - upsertAt[upsertAt.length - 1]).toBeLessThan(60_000);
    expect(sentPoints()).toEqual([]); // courier_assigned: still nothing to the customer
  });

  it("iOS keeps its 25 m filter (no timeInterval there: 0 would mean a fix and a server read per second)", async () => {
    h.state.platform.OS = "ios";
    await gps.startDeliveryTracking("o1", "c1");
    expect(h.state.options).toMatchObject({ timeInterval: 10_000, distanceInterval: 25 });
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

// Google Play: background location needs a prominent in-app disclosure BEFORE the runtime prompt.
describe("background location disclosure", () => {
  beforeEach(() => {
    h.state.bgStatus = "denied";
    h.state.bgRequests = 0;
    h.state.started = false;
  });

  it("not granted + courier accepts the disclosure -> the OS prompt is shown once, no warning", async () => {
    const gps = await import("../src/lib/backgroundLocation");
    let asked = 0;
    const warning = await gps.startDeliveryTracking("d1", "c1", async () => (asked++, true));
    expect(asked).toBe(1);
    expect(h.state.bgRequests).toBe(1);
    expect(warning).toBeNull();
  });

  it("not granted + courier declines -> NO OS prompt, foreground tracking still starts, the warning says so", async () => {
    const gps = await import("../src/lib/backgroundLocation");
    const warning = await gps.startDeliveryTracking("d2", "c1", async () => false);
    expect(h.state.bgRequests).toBe(0);
    expect(h.state.started).toBe(true);
    expect(warning).toMatch(/Întotdeauna/);
  });

  it("no disclosure function (a caller without UI) never triggers the OS prompt", async () => {
    const gps = await import("../src/lib/backgroundLocation");
    await gps.startDeliveryTracking("d3", "c1");
    expect(h.state.bgRequests).toBe(0);
  });

  it("already granted -> neither the disclosure nor the prompt", async () => {
    h.state.bgStatus = "granted";
    const gps = await import("../src/lib/backgroundLocation");
    let asked = 0;
    const warning = await gps.startDeliveryTracking("d4", "c1", async () => (asked++, true));
    expect(asked).toBe(0);
    expect(h.state.bgRequests).toBe(0);
    expect(warning).toBeNull();
  });

  it("declined once for an order -> not asked again for the same order (screens re-run start)", async () => {
    const gps = await import("../src/lib/backgroundLocation");
    let asked = 0;
    const no = async () => (asked++, false);
    await gps.startDeliveryTracking("d5", "c1", no);
    await gps.startDeliveryTracking("d5", "c1", no);
    expect(asked).toBe(1);
    await gps.startDeliveryTracking("d6", "c1", no);
    expect(asked).toBe(2);
  });

  it("both screens that start tracking pass the UI disclosure, and its text says what Play requires", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    expect(read("src/screens/ActiveDeliveryScreen.tsx")).toMatch(/startDeliveryTracking\(order\.id, courierId, askBackgroundDisclosure\)/);
    expect(read("src/screens/MapScreen.tsx")).toMatch(/startDeliveryTracking\(activeOrderId, courierId, askBackgroundDisclosure\)/);
    const text = read("src/lib/locationDisclosure.ts");
    expect(text).toMatch(/în fundal/);
    expect(text).toMatch(/închisă sau nu o folosești/);
    expect(text).toMatch(/doar cât ai o livrare activă/);
  });
});
