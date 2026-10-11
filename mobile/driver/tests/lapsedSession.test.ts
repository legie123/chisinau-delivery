import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createStatusQueue, isNetworkError, type KeyValueStorage } from "@chisinau/shared-domain";

// The app's REAL client (src/lib/supabase.ts: supabase-js 2.109 auth + postgrest, the chunked
// keychain storage) under a lapsed session — the token expired in a dead zone, the refresh failed,
// auth-js serves that failure for 60 s (REFRESH_FAILURE_COOLDOWN_MS) — and during a routine refresh
// that rewrites the keychain. Only the network (GoTrue + PostgREST, RLS-shaped: an anon token sees
// no rows), the keychain, the clock and the native GPS/push modules are faked.
const ANON = "anon-key-test";
const h = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54421";
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "anon-key-test";
  return {
    clock: 1_800_000_000_000,
    keychain: new Map<string, string>(),
    keychainDeleteThrows: false,
    beforeKeychainSet: null as null | ((key: string) => Promise<void>),
    gotrue: "up" as "up" | "down" | "revoked",
    logout: "up" as "up" | "down",
    rest: [] as string[], // every request that REACHED the server
    onRest: null as null | ((path: string) => Promise<void> | void),
    orders: [] as Record<string, unknown>[], // what RLS shows the courier's own token
    calls: [] as string[], // push token side effects
    task: null as null | ((body: { data: unknown; error: null }) => Promise<void>),
    gpsStarted: false,
    asyncStorage: new Map<string, string>(),
  };
});

vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: "android" } }));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: 0,
  getItemAsync: async (k: string) => h.keychain.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    await h.beforeKeychainSet?.(k);
    h.keychain.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    if (h.keychainDeleteThrows) throw new Error("Could not delete item from keystore");
    h.keychain.delete(k);
  },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => h.asyncStorage.get(k) ?? null,
    setItem: async (k: string, v: string) => void h.asyncStorage.set(k, v),
    removeItem: async (k: string) => void h.asyncStorage.delete(k),
  },
}));
vi.mock("expo-task-manager", () => ({ defineTask: (_n: string, fn: typeof h.task) => void (h.task = fn) }));
vi.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  ActivityType: { OtherNavigation: 4 },
  requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
  getBackgroundPermissionsAsync: async () => ({ status: "granted" }),
  requestBackgroundPermissionsAsync: async () => ({ status: "granted" }),
  hasStartedLocationUpdatesAsync: async () => h.gpsStarted,
  startLocationUpdatesAsync: async () => void (h.gpsStarted = true),
  stopLocationUpdatesAsync: async () => void (h.gpsStarted = false),
}));
vi.mock("../src/lib/offlineQueue", () => ({ statusQueue: { read: async () => [] } }));
vi.mock("../src/lib/push", () => ({
  unregisterPush: async () => void h.calls.push("deletePushToken"),
  registerForPush: async () => (h.calls.push("bindPushToken"), null),
}));

const USER = {
  id: "user-k",
  aud: "authenticated",
  role: "authenticated",
  email: "curier@test.md",
  app_metadata: { provider: "email", pad: "x".repeat(1500) }, // a real session needs several keychain chunks
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
let serial = 0;
function session(ttlSec: number) {
  serial += 1;
  const exp = Math.floor(h.clock / 1000) + ttlSec;
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, exp, role: "authenticated", serial })}.sig`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `rt-${serial}`,
    user: USER,
  };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

vi.spyOn(Date, "now").mockImplementation(() => h.clock);
vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/auth/v1/token")) {
    if (h.gotrue === "down") {
      h.clock += 31_000; // timed out — auth-js does not retry past its 30 s tick
      throw new TypeError("Network request failed");
    }
    if (h.gotrue === "revoked") return json({ code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }, 400);
    return json(session(3600));
  }
  if (url.includes("/auth/v1/logout")) {
    h.rest.push("POST logout");
    if (h.logout === "down") throw new TypeError("Network request failed");
    return new Response(null, { status: 204 });
  }
  const table = url.split("/rest/v1/")[1]?.split("?")[0];
  if (!table) throw new Error(`unexpected request ${url}`);
  const who = new Headers(init?.headers).get("Authorization") === `Bearer ${ANON}` ? "anon" : "courier";
  h.rest.push(`${init?.method ?? "GET"} ${table} as ${who}`);
  await h.onRest?.(table);
  if (who === "anon") return table.startsWith("rpc/") ? json({ code: "42501", message: "permission denied" }, 401) : json([]);
  if (table === "couriers") return json([{ id: "c1", status: "on_delivery" }]);
  if (table === "orders") return json(h.orders);
  return table.startsWith("rpc/") ? new Response(null, { status: 204 }) : json([]);
});

const { supabase } = await import("../src/lib/supabase");
const { createChunkedStorage } = await import("../src/lib/chunkedStorage");
const { makeQueueAdvance } = await import("../src/lib/advance");
const api = await import("../src/lib/api");
const gps = await import("../src/lib/backgroundLocation");
await supabase.auth.getSession(); // initialized: its auto-refresh ticker is running now
await supabase.auth.stopAutoRefresh(); // the tests drive every refresh themselves

const KEY = (supabase.auth as unknown as { storageKey: string }).storageKey;
// Writes the keychain in the app's own chunked format, around the test hooks.
const keychain = createChunkedStorage({
  getItemAsync: async (k) => h.keychain.get(k) ?? null,
  setItemAsync: async (k, v) => void h.keychain.set(k, v),
  deleteItemAsync: async (k) => void h.keychain.delete(k),
});
const seed = (ttlSec: number) => keychain.setItem(KEY, JSON.stringify(session(ttlSec)));
const stored = () => keychain.getItem(KEY);

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

// A dead zone at token expiry: the refresh fails once and auth-js serves that failure for 60 s.
async function lapse() {
  await seed(-10);
  h.gotrue = "down";
  const { data, error } = await supabase.auth.getSession();
  expect(data.session).toBeNull();
  expect(error?.name).toBe("AuthRetryableFetchError");
  h.gotrue = "up"; // GoTrue is back, the cooldown is not over yet
}

const anonRequests = () => h.rest.filter((r) => r.endsWith(" as anon"));

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  h.clock += 600_000; // past every earlier cooldown
  Object.assign(h, {
    keychainDeleteThrows: false,
    beforeKeychainSet: null,
    gotrue: "up",
    logout: "up",
    rest: [],
    onRest: null,
    orders: [{ id: "o1", status: "en_route", courier_id: "c1" }],
    calls: [],
  });
});

describe("a queued 'am livrat' is never dropped as 'reassigned' by a read made without the courier's token (MED #0)", () => {
  it("the cooldown ends while the read is in flight: kept, then delivered once the session is back", async () => {
    await lapse();
    h.clock += 59_000; // 1 s of cooldown left
    // The answer lands after the cooldown (slow network): the old post-read session check refreshed
    // then, saw a session, and took the anon "no row" for a reassignment.
    h.onRest = (table) => {
      if (table === "orders") h.clock += 2_000;
    };
    const queue = createStatusQueue(memoryStorage());
    await queue.enqueue({ orderId: "o1", newStatus: "delivered", paymentConfirmed: true, ts: 1 });
    await queue.drain(makeQueueAdvance(supabase));
    expect(await queue.count()).toBe(1);
    expect(await queue.giveUpCount()).toBe(0);
    expect(anonRequests()).toEqual([]); // never sent: answered on the phone as "no courier session"

    h.onRest = null;
    h.clock += 2_000; // cooldown over: the next drain refreshes and delivers
    await queue.drain(makeQueueAdvance(supabase));
    expect(h.rest).toContain("POST rpc/advance_delivery_status as courier");
    expect(await queue.count()).toBe(0);
  });

  it("a routine refresh rewrites the keychain while a drain reads: kept (no outage needed)", async () => {
    await seed(60); // inside auth-js's 90 s margin: the next getSession refreshes
    const queue = createStatusQueue(memoryStorage());
    await queue.enqueue({ orderId: "o1", newStatus: "delivered", paymentConfirmed: true, ts: 1 });
    let drain: Promise<void> | null = null;
    let readSent!: () => void;
    const readReachedServer = new Promise<void>((r) => (readSent = r));
    // chunkedStorage.setItem deletes the old session first: right before the first new chunk is
    // written getItem reads null, and supabase-js has no token for a read started there.
    h.beforeKeychainSet = async (key) => {
      if (drain || key !== `${KEY}.0`) return;
      expect(await keychain.getItem(KEY)).toBeNull();
      drain = queue.drain(makeQueueAdvance(supabase));
      await Promise.race([drain, readReachedServer]);
    };
    const refresh = supabase.auth.getSession();
    h.onRest = async (table) => {
      if (table !== "orders") return;
      readSent();
      await refresh; // the answer lands after the new session is stored
    };
    expect((await refresh).data.session).not.toBeNull();
    await drain;
    expect(drain).not.toBeNull();
    expect(await queue.count()).toBe(1);
    expect(await queue.giveUpCount()).toBe(0);
    expect(anonRequests()).toEqual([]);
  });

  it("control: a TRUE reassignment (no row for the courier's own token) is still dropped at once", async () => {
    await seed(3600);
    h.orders = [];
    const queue = createStatusQueue(memoryStorage());
    await queue.enqueue({ orderId: "o1", newStatus: "delivered", paymentConfirmed: true, ts: 1 });
    await queue.drain(makeQueueAdvance(supabase));
    expect(h.rest).toContain("GET orders as courier");
    expect(await queue.count()).toBe(0);
  });
});

describe("background GPS: no session = cannot tell = hold, never 'not mine' = stop (MED #1)", () => {
  const fix = { data: { locations: [{ coords: { latitude: 47.02, longitude: 28.86, accuracy: 5 } }] }, error: null };

  it("a read straddling the cooldown end keeps tracking; the next fix upserts as the courier", async () => {
    h.orders = [{ id: "o1", status: "courier_assigned", courier_id: "c1" }]; // heading to the pickup
    await gps.startDeliveryTracking("o1", "c1");
    await lapse();
    h.clock += 59_800;
    h.onRest = (table) => {
      if (table === "orders") h.clock += 400;
    };
    await h.task!(fix);
    expect(await gps.trackedOrderId()).toBe("o1");
    expect(h.gpsStarted).toBe(true);
    expect(anonRequests()).toEqual([]);

    h.onRest = null;
    h.clock += 1_000; // cooldown over
    await h.task!(fix);
    expect(h.rest).toEqual(["GET orders as courier", "POST courier_locations as courier"]);
    await gps.stopDeliveryTracking();
  });

  it("control: reassigned (no row for the courier's own token) still stops", async () => {
    await seed(3600);
    h.orders = [];
    await gps.startDeliveryTracking("o1", "c1");
    await h.task!(fix);
    expect(await gps.trackedOrderId()).toBeNull();
    expect(h.gpsStarted).toBe(false);
  });
});

describe("a lapsed session reads as 'cannot tell' everywhere, never as 'no delivery' (MED #2)", () => {
  it("MapScreen's reads and the offer-tap / sign-out check reject network-shaped instead of null / false", async () => {
    await lapse();
    const results = await Promise.allSettled([
      api.getMyCourierId(), // was null → MapScreen stopped GPS
      api.hasActiveDelivery(), // was false → an offer tap popped a live delivery, sign-out went ahead
      api.fetchActiveOrder(), // was null → MapScreen stopped GPS
      api.fetchMyCourierStatus(),
    ]);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect(isNetworkError((r as PromiseRejectedResult).reason)).toBe(true);
    }
    expect(api.userMessage((results[0] as PromiseRejectedResult).reason)).toMatch(/Fără conexiune/);
    expect(anonRequests()).toEqual([]);
  });

  it("app start: a lapsed stored session stays in (cannot tell); signed out or revoked goes to the login screen", async () => {
    await seed(-10);
    h.gotrue = "down";
    expect(await api.restoreCourierSession()).toBe(true);
    expect(await stored()).not.toBeNull();

    await keychain.removeItem(KEY); // signed out: nothing stored
    expect(await api.restoreCourierSession()).toBe(false);

    await seed(-10);
    h.gotrue = "revoked"; // GoTrue refuses the refresh token: auth-js removes the session (SIGNED_OUT)
    expect(await api.restoreCourierSession()).toBe(false);
    expect(await stored()).toBeNull();
  });

  it("INITIAL_SESSION also arrives without a session on a lapse, so App.tsx leaves only on SIGNED_OUT", async () => {
    await lapse();
    const events: [string, boolean][] = [];
    const { data } = supabase.auth.onAuthStateChange((event, s) => void events.push([event, !!s]));
    await vi.waitFor(() => expect(events).toEqual([["INITIAL_SESSION", false]]));
    data.subscription.unsubscribe();
    const app = readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
    expect(app).not.toMatch(/if \(!session\) setSignedIn\(false\)/);
    expect(app).toMatch(/if \(event !== 'SIGNED_OUT'\) return;\s*setSignedIn\(false\);/);
  });
});

describe("sign-out when /logout is not confirmed (MED #4) or the keystore fails after it (LOW #8)", () => {
  beforeEach(() => {
    h.orders = []; // no delivery on his hands
  });

  it("no signal at /logout: told in Romanian, still signed in, the deleted push token bound again", async () => {
    await seed(3600);
    h.logout = "down";
    const msg = await api.signOut();
    expect(msg).not.toBeNull(); // was null: "signed out" while the session stayed
    expect(msg).toMatch(/Deconectarea nu e completă/);
    expect(msg).toMatch(/Nu te-am deconectat/);
    expect(await stored()).not.toBeNull();
    expect(h.calls).toEqual(["deletePushToken", "bindPushToken"]);
  });

  it("„Deconectează oricum” with no signal is not a silent no-op either", async () => {
    await seed(3600);
    h.logout = "down";
    const msg = await api.signOut(true);
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/Nu te-am deconectat/);
    expect(await stored()).not.toBeNull();
    expect(h.calls).toEqual(["deletePushToken", "bindPushToken"]);
  });

  it("the keystore throws AFTER /logout revoked the session: told, and the token is NOT bound on it", async () => {
    await seed(3600);
    h.keychainDeleteThrows = true;
    const msg = await api.signOut();
    expect(h.rest).toContain("POST logout");
    expect(msg).toMatch(/sesiunea nu a putut fi închisă/);
    expect(msg).toMatch(/Notificările de oferte sunt oprite/);
    expect(h.calls).toEqual(["deletePushToken"]);
  });

  it("control: /logout confirmed → signed out, no message", async () => {
    await seed(3600);
    expect(await api.signOut()).toBeNull();
    expect(await stored()).toBeNull();
  });
});
