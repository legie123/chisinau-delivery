// Verifier findings on the customer app (client-native). Every block names the
// finding it pins. Native modules are stubbed; the app's own code runs for real.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "@chisinau/shared-api";
import { EMPTY_CART, addToCart, chosenOptions, type CartLine, type OptionGroupLike } from "@chisinau/shared-domain";

// ---------- stubs: react-native / expo / supabase ----------
const h = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, unknown[]>,
    deleteError: null as null | { message: string },
    deletes: [] as { table: string; filters: unknown[][] }[],
    session: { user: { id: "u1" } } as unknown,
    secure: new Map<string, string>(),
    expoToken: "ExponentPushToken[abc]",
    permission: "granted",
  };
  const signOut = vi.fn(async () => ({ error: null }));
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  function builder(table: string) {
    const q: Record<string, unknown> & { filters: unknown[][]; op: string } = { filters: [], op: "select" };
    for (const m of ["select", "eq", "in", "order", "limit", "single", "maybeSingle"]) {
      q[m] = (...a: unknown[]) => {
        q.filters.push([m, ...a]);
        return q;
      };
    }
    q.delete = () => {
      q.op = "delete";
      return q;
    };
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      if (q.op === "delete") {
        state.deletes.push({ table, filters: q.filters });
        return Promise.resolve({ data: null, error: state.deleteError }).then(res, rej);
      }
      return Promise.resolve({ data: state.tables[table] ?? [], error: null }).then(res, rej);
    };
    return q;
  }
  const supabase = {
    from: (t: string) => builder(t),
    rpc,
    auth: { getSession: async () => ({ data: { session: state.session } }), signOut },
  };
  return { state, signOut, rpc, supabase };
});

vi.mock("../src/lib/supabase", () => ({ supabase: h.supabase }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: { eas: { projectId: "p1" } } } } }));
vi.mock("expo-notifications", () => ({
  setNotificationHandler: () => undefined,
  setNotificationChannelAsync: async () => undefined,
  AndroidImportance: { HIGH: 4 },
  getPermissionsAsync: async () => ({ status: h.state.permission }),
  requestPermissionsAsync: async () => ({ status: h.state.permission }),
  getExpoPushTokenAsync: async () => ({ data: h.state.expoToken }),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => h.state.secure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void h.state.secure.set(k, v),
  deleteItemAsync: async (k: string) => void h.state.secure.delete(k),
}));

const rpcError = (message: string, code = "P0001") => new RpcError({ code, message, details: "", hint: "" } as never);
const appRoot = path.resolve(__dirname, "..");
const src = (f: string) => readFileSync(path.join(appRoot, f), "utf8");

beforeEach(() => {
  h.state.tables = {};
  h.state.deleteError = null;
  h.state.deletes = [];
  h.state.session = { user: { id: "u1" } };
  h.state.secure.clear();
  h.state.permission = "granted";
  h.signOut.mockClear();
  h.rpc.mockClear();
});

// ---------- MED: raw English RPC text in alerts ----------
describe("errorText never shows raw English RPC text", () => {
  const ENGLISH = [
    "too late to cancel",
    "too late to tip",
    "order not delivered yet",
    "already rated",
    "rating window closed",
    "invalid transition from cancelled — comanda nu mai poate fi confirmată",
    "no active quote to confirm",
    "invalid tip",
  ];
  it.each(ENGLISH)("%s → Romanian", async (raw) => {
    const { errorText } = await import("../src/lib/api");
    const shown = errorText(rpcError(raw), "FALLBACK");
    expect(shown).not.toContain(raw.split(" — ")[0]);
    expect(shown).not.toBe("FALLBACK"); // a specific message, not the generic one
    expect(shown).toMatch(/[ăâîșț]/);
  });

  it("an unknown English P0001 message falls back; a Romanian one passes through", async () => {
    const { errorText } = await import("../src/lib/api");
    expect(errorText(rpcError("quote already submitted"), "Nu am putut.")).toBe("Nu am putut.");
    expect(errorText(rpcError("adresa de livrare nu îți aparține"), "x")).toBe("adresa de livrare nu îți aparține");
    expect(errorText(rpcError("dup", "23505"), "x")).toBe("Acțiunea a fost deja efectuată.");
  });

  it("stale cart option errors get an actionable Romanian message (not the generic retry)", async () => {
    const { errorText } = await import("../src/lib/api");
    for (const raw of ["opțiune invalidă pentru Dragon Roll", 'prea multe opțiuni la "Sos"', 'prea puține opțiuni la "Extra"']) {
      expect(errorText(rpcError(raw), "GENERIC")).toBe("Un produs din coș s-a schimbat — scoate-l și adaugă-l din nou.");
    }
  });
});

// ---------- MED: catering ignores required option groups ----------
const SOS: OptionGroupLike & { menuItemId: string } = {
  id: "g1",
  menuItemId: "cal",
  name: "Sos",
  is_required: true,
  min_select: 1,
  max_select: 1,
  options: [
    { id: "o1", name: "Spicy", price_delta_mdl: 5, is_available: true },
    { id: "o2", name: "Teriyaki", price_delta_mdl: 0, is_available: true },
  ],
};

describe("catering: required option groups are chosen before the request is sent", () => {
  it("fetchMenu loads option groups in catering mode too", async () => {
    h.state.tables.menu_items = [
      { id: "cal", restaurant_id: "r1", name: "California Roll", description: null, price_mdl: 120, photo_url: null, category_id: null, catering_min_qty: 10 },
    ];
    h.state.tables.menu_option_groups = [
      { id: "g1", menu_item_id: "cal", name: "Sos", is_required: true, min_select: 1, max_select: 1, menu_options: SOS.options },
    ];
    const { fetchMenu } = await import("../src/lib/api");
    const menu = await fetchMenu("r1", { catering: true });
    expect(menu.groups.cal?.map((g) => g.name)).toEqual(["Sos"]);
  });

  const items = [{ id: "cal", name: "California Roll", cateringMinQty: 10 }];
  const groups = { cal: [SOS] };
  const r = { id: "r1", name: "Sakura" };
  const ref = { id: "cal", name: "California Roll", price_mdl: 120 };

  it("a line without its required option is caught locally, in Romanian", async () => {
    const { cateringProblem } = await import("../src/lib/catering");
    const bare = addToCart(EMPTY_CART, r, ref, undefined, 10);
    expect(cateringProblem(bare.lines, items, groups)).toMatch(/„California Roll” are opțiuni obligatorii/);
    const ok = addToCart(EMPTY_CART, r, ref, chosenOptions(ref, [SOS], { g1: ["o1"] }), 10);
    expect(cateringProblem(ok.lines, items, groups)).toBeNull();
    const few = addToCart(EMPTY_CART, r, ref, chosenOptions(ref, [SOS], { g1: ["o1"] }), 3);
    expect(cateringProblem(few.lines, items, groups)).toMatch(/minim 10 buc/);
    expect(cateringProblem([], items, groups)).toMatch(/cel puțin un articol/);
  });

  it("the payload carries the chosen option_ids and a per-attempt idempotency key", async () => {
    const { buildCateringInput } = await import("../src/lib/catering");
    const cart = addToCart(EMPTY_CART, r, ref, chosenOptions(ref, [SOS], { g1: ["o1"] }), 10);
    const input = buildCateringInput({
      restaurantId: "r1",
      lines: cart.lines,
      requestedFor: "2026-10-10T09:00:00.000Z",
      idempotencyKey: "k1",
      form: { date: "2026-10-10", time: "12:00", guests: "20", address: " Str. X ", person: "Ion", phone: "069000000", notes: "" },
    });
    expect(input.items).toEqual([{ menu_item_id: "cal", quantity: 10, option_ids: ["o1"] }]);
    expect(input.idempotencyKey).toBe("k1");
    expect(input.orderType).toBe("catering");
    expect(input.catering?.event_address_text).toBe("Str. X");
  });
});

// ---------- MED: push token survives sign-out ----------
describe("push token is unbound on sign-out, even in a fresh run or offline", () => {
  it("a token registered in an earlier run is deleted by sign-out in a fresh run", async () => {
    vi.resetModules();
    const first = await import("../src/lib/push");
    expect(await first.registerForPush()).toBe("registered");
    vi.resetModules(); // app restart: module memory gone
    h.state.expoToken = "ExponentPushToken[rotated-unavailable]";
    const fresh = await import("../src/lib/push");
    await fresh.unregisterPush();
    expect(h.state.deletes).toHaveLength(1);
    expect(h.state.deletes[0].filters).toContainEqual(["eq", "expo_token", "ExponentPushToken[abc]"]);
    h.state.expoToken = "ExponentPushToken[abc]";
  });

  it("a run that never registered still unbinds this device's current token", async () => {
    vi.resetModules();
    const push = await import("../src/lib/push");
    await push.unregisterPush();
    expect(h.state.deletes[0]?.filters).toContainEqual(["eq", "expo_token", "ExponentPushToken[abc]"]);
  });

  it("a failed delete throws and the session is KEPT (sign-out refused, retry possible)", async () => {
    vi.resetModules();
    const push = await import("../src/lib/push");
    await push.registerForPush();
    h.state.deleteError = { message: "Network request failed" };
    const signOutFn = (push as Record<string, unknown>).signOutAndUnbindPush as () => Promise<void>;
    expect(typeof signOutFn).toBe("function");
    await expect(signOutFn()).rejects.toThrow(/notificările/);
    expect(h.signOut).not.toHaveBeenCalled();
    h.state.deleteError = null; // back online: the retry unbinds, then signs out
    await signOutFn();
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.state.deletes.at(-1)?.filters).toContainEqual(["eq", "expo_token", "ExponentPushToken[abc]"]);
  });

  it("ProfileScreen signs out only through the unbinding path", () => {
    const profile = src("src/screens/ProfileScreen.tsx");
    expect(profile).toMatch(/signOutAndUnbindPush\(\)/);
    expect(profile).not.toMatch(/supabase\.auth\.signOut\(/);
  });
});

// ---------- MED: stale cart never reconciled with the live menu ----------
describe("cart reconciliation against the live menu (web useCartReconcile parity)", () => {
  const line = (over: Partial<CartLine>): CartLine => ({
    lineId: "m1",
    menuItemId: "m1",
    name: "Philadelphia",
    priceMdl: 180,
    quantity: 2,
    optionIds: [],
    optionsLabel: "",
    ...over,
  });

  it("reprices moved lines, flags dead ones (item or option gone/unavailable)", async () => {
    const { reconcileLines } = await import("../src/lib/cartReconcile");
    const lines = [
      line({}),
      line({ lineId: "m2::o1", menuItemId: "m2", name: "Dragon", priceMdl: 200, optionIds: ["o1"] }),
      line({ lineId: "m3", menuItemId: "m3", name: "Miso", priceMdl: 40 }),
      line({ lineId: "m4::o9", menuItemId: "m4", name: "Mochi", priceMdl: 50, optionIds: ["o9"] }),
    ];
    const r = reconcileLines(
      lines,
      [
        { id: "m1", price_mdl: 195, is_available: true },
        { id: "m2", price_mdl: 200, is_available: true },
        { id: "m3", price_mdl: 40, is_available: false },
        { id: "m4", price_mdl: 50, is_available: true },
      ],
      [{ id: "o1", price_delta_mdl: 10.5, is_available: true }],
    );
    expect(r.lines.map((l) => l.priceMdl)).toEqual([195, 210.5, 40, 50]);
    expect(r.repriced).toEqual([
      { lineId: "m1", name: "Philadelphia", from: 180, to: 195 },
      { lineId: "m2::o1", name: "Dragon", from: 200, to: 210.5 },
    ]);
    expect(r.dead.map((d) => d.lineId)).toEqual(["m3", "m4::o9"]);
  });

  it("CartScreen runs the reconciliation and blocks checkout on dead lines", () => {
    const cart = src("src/screens/CartScreen.tsx");
    expect(cart).toMatch(/reconcileLines\(/);
    expect(cart).toMatch(/Restaurantul a actualizat prețurile/);
    expect(cart).toMatch(/deadLines\.length > 0/);
  });
});

// ---------- MED: order goes to the wrong address ----------
describe("checkout address: edits after a failed attempt are never ignored", () => {
  const draft: { street: string; phone: string; notes: string; pin: { lat: number; lng: number } | null } = {
    street: "Str. A 1",
    phone: "069111111",
    notes: "",
    pin: null,
  };

  it("the address row from a failed attempt is reused only while the draft is unchanged", async () => {
    const checkout = (await import("../src/lib/checkout")) as Record<string, unknown>;
    const fp = checkout.addressFingerprint as (d: typeof draft) => string;
    const reuse = checkout.reusableAddressId as (c: { id: string; fingerprint: string } | null, d: typeof draft) => string | null;
    const cache = { id: "addr-1", fingerprint: fp(draft) };
    expect(reuse(cache, { ...draft })).toBe("addr-1");
    expect(reuse(cache, { ...draft, street: "Str. B 2" })).toBeNull();
    expect(reuse(cache, { ...draft, phone: "069222222" })).toBeNull();
    expect(reuse(cache, { ...draft, notes: "et. 3" })).toBeNull();
    expect(reuse(cache, { ...draft, pin: { lat: 47, lng: 28.8 } })).toBeNull();
    expect(reuse(null, draft)).toBeNull();
  });

  it("a saved address is the default only until the user picks or types (Login detour)", async () => {
    const checkout = (await import("../src/lib/checkout")) as Record<string, unknown>;
    const pick = checkout.defaultAddressChoice as (cur: string, list: { id: string }[], touched: boolean) => string;
    expect(pick("new", [{ id: "a1" }], false)).toBe("a1");
    expect(pick("new", [{ id: "a1" }], true)).toBe("new");
    expect(pick("a2", [{ id: "a1" }], false)).toBe("a2");
    expect(pick("new", [], false)).toBe("new");
  });
});

// ---------- LOW: iOS "Always" strings + SYSTEM_ALERT_WINDOW ----------
describe("manifest: no Always-location strings, no overlay permission", () => {
  it("app.json disables the expo-location Always strings and blocks SYSTEM_ALERT_WINDOW", () => {
    const expo = JSON.parse(src("app.json")).expo;
    const loc = expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-location")[1];
    expect(loc.locationAlwaysAndWhenInUsePermission).toBe(false);
    expect(loc.locationAlwaysPermission).toBe(false);
    expect(expo.android.blockedPermissions).toContain("android.permission.SYSTEM_ALERT_WINDOW");
    expect(expo.ios.infoPlist.NSLocationAlwaysUsageDescription).toBeUndefined();
  });
});

// ---------- LOW: no hours rows = open in the app, closed on the server ----------
describe("restaurant with no schedule is closed (server + web parity)", () => {
  it("toRestaurant: [] / undefined hours → openNow false", async () => {
    const api = (await import("../src/lib/api")) as Record<string, unknown>;
    const toRestaurant = api.toRestaurant as (...a: unknown[]) => { openNow: boolean; nextOpening: string | null };
    expect(typeof toRestaurant).toBe("function");
    const row = {
      id: "r1", slug: "r", name: "R", cuisine_type: "sushi", venue_type: "restaurant", address: "", lat: null, lng: null,
      logo_url: null, cover_photo_url: null, rating_avg: null, rating_count: 0, avg_prep_minutes: 30, delivery_fee_mdl: 30,
      min_order_amount_mdl: 100, accepting_orders: true, accepts_catering: false, catering_min_amount_mdl: null,
    };
    expect(toRestaurant(row, undefined, [], null, 1, "12:00").openNow).toBe(false);
    expect(toRestaurant(row, undefined, undefined, null, 1, "12:00").openNow).toBe(false);
  });
});

// ---------- LOW: INSERT event shows Total 0.00 ----------
describe("order-row subscription ignores place_order's own INSERT", () => {
  it("only UPDATE rows reach the screen", async () => {
    const { subscribeOrderRow } = await import("../src/lib/realtime");
    let handler: (p: unknown) => void = () => undefined;
    const channel = {
      on: (_e: string, _f: unknown, cb: (p: unknown) => void) => ((handler = cb), channel),
      subscribe: () => channel,
    };
    const db = { channel: () => channel, removeChannel: () => undefined };
    const rows: unknown[] = [];
    subscribeOrderRow(db as never, "o1", (r) => rows.push(r), () => undefined);
    handler({ eventType: "INSERT", new: { id: "o1", status: "pending_restaurant", total_mdl: 0 } });
    handler({ eventType: "UPDATE", new: { id: "o1", status: "pending_restaurant", total_mdl: 465 } });
    expect(rows).toEqual([{ id: "o1", status: "pending_restaurant", total_mdl: 465 }]);
  });
});

// ---------- LOW: double taps, catering idempotency, cold-start push ----------
describe("double-tap and notification routing", () => {
  it("runExclusive: a second tap while the first is in flight does nothing", async () => {
    const checkout = (await import("../src/lib/checkout")) as Record<string, unknown>;
    const runExclusive = checkout.runExclusive as (lock: { current: boolean }, fn: () => Promise<void>) => Promise<void>;
    const lock = { current: false };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = vi.fn(async () => gate);
    const a = runExclusive(lock, fn);
    const b = runExclusive(lock, fn);
    release();
    await Promise.all([a, b]);
    expect(fn).toHaveBeenCalledTimes(1);
    await runExclusive(lock, fn); // released after the first finished
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it.each(["src/screens/CartScreen.tsx", "src/screens/CateringScreen.tsx"])("%s locks BEFORE the first await", (f) => {
    const s = src(f);
    const lock = s.indexOf("runExclusive(");
    expect(lock).toBeGreaterThan(-1);
    expect(s.indexOf("await isSignedIn()")).toBeGreaterThan(lock);
  });

  it("push targets: orders, catering and concierge bookings", async () => {
    const push = (await import("../src/lib/push")) as Record<string, unknown>;
    const pushTarget = push.pushTarget as (u: unknown) => unknown;
    const id = "0b5c3a8e-1111-4222-8333-944455556666";
    expect(pushTarget(`/orders/${id}`)).toEqual({ name: "OrderTracking", params: { orderId: id } });
    expect(pushTarget(`/catering/${id}`)).toEqual({ name: "OrderTracking", params: { orderId: id } });
    expect(pushTarget("/concierge/rezervari")).toEqual({ name: "Concierge" });
    expect(pushTarget("/restaurant/orders")).toBeNull();
  });

  it("a cold-start tap that arrives before navigation is ready opens on onReady", async () => {
    const push = (await import("../src/lib/push")) as Record<string, unknown>;
    const createPushOpener = push.createPushOpener as (nav: unknown) => { open: (t: unknown) => void; flush: () => void };
    let ready = false;
    const navigate = vi.fn();
    const opener = createPushOpener({ isReady: () => ready, navigate });
    opener.open({ name: "OrderTracking", params: { orderId: "o1" } });
    expect(navigate).not.toHaveBeenCalled();
    ready = true;
    opener.flush();
    expect(navigate).toHaveBeenCalledWith("OrderTracking", { orderId: "o1" });
    opener.flush();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(src("App.tsx")).not.toMatch(/setTimeout\(/);
    expect(src("App.tsx")).toMatch(/onReady=/);
  });
});
