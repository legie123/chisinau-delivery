// Third verifier round on the customer app. Native modules are stubbed; the app's
// own push.ts and api.ts run for real against a fake PostgREST that applies
// max_rows (1000) per read node the way the live one does (embeds: per parent).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const MAX_ROWS = 1000;
  const state = {
    restaurants: [] as Record<string, unknown>[],
    hours: [] as { restaurant_id: string }[],
    deleteError: null as null | { message: string },
    deletes: [] as unknown[][][],
    rpcError: null as null | { message: string; code: string },
    secure: new Map<string, string>(),
    tokenError: null as null | Error,
    signOutResult: { error: null } as { error: null | { name: string; message: string; status?: number } },
  };
  const signOut = vi.fn(async (_opts?: unknown) => state.signOutResult);
  const rpc = vi.fn(async (_fn: string, _args?: unknown) => ({ data: state.rpcError ? null : [], error: state.rpcError }));
  function builder(table: string) {
    const filters: unknown[][] = [];
    let cols = "";
    let op = "select";
    const q: Record<string, unknown> = {
      select: (c: string) => ((cols = c), q),
      delete: () => ((op = "delete"), q),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        if (op === "delete") {
          state.deletes.push(filters);
          return Promise.resolve({ data: null, error: state.deleteError }).then(res, rej);
        }
        let rows: Record<string, unknown>[] =
          table === "restaurants"
            ? state.restaurants.map((r) =>
                cols.includes("restaurant_hours(")
                  ? { ...r, restaurant_hours: state.hours.filter((x) => x.restaurant_id === r.id).slice(0, MAX_ROWS) }
                  : r,
              )
            : table === "restaurant_hours"
              ? state.hours
              : [];
        for (const [m, col, v] of filters) if (m === "in" && col === "restaurant_id") rows = rows.filter((x) => (v as unknown[]).includes(x.restaurant_id));
        return Promise.resolve({ data: rows.slice(0, MAX_ROWS), error: null }).then(res, rej);
      },
    };
    for (const m of ["eq", "in", "order", "limit"]) q[m] = (...a: unknown[]) => (filters.push([m, ...a]), q);
    return q;
  }
  const supabase = {
    from: (t: string) => builder(t),
    rpc,
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }), signOut },
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
  getPermissionsAsync: async () => ({ status: "granted" }),
  requestPermissionsAsync: async () => ({ status: "granted" }),
  getExpoPushTokenAsync: async () => {
    if (h.state.tokenError) throw h.state.tokenError;
    return { data: "ExponentPushToken[abc]" };
  },
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => h.state.secure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void h.state.secure.set(k, v),
  deleteItemAsync: async (k: string) => void h.state.secure.delete(k),
}));

const TOKEN = "ExponentPushToken[abc]";
const GOTRUE_DOWN = { error: { name: "AuthApiError", message: "upstream connect error", status: 502 } };

beforeEach(() => {
  vi.resetModules();
  h.state.restaurants = [];
  h.state.hours = [];
  h.state.deleteError = null;
  h.state.deletes = [];
  h.state.rpcError = null;
  h.state.secure.clear();
  h.state.tokenError = null;
  h.state.signOutResult = { error: null };
  h.signOut.mockClear();
  h.rpc.mockClear();
});

// ---------- MED #0: the app's own sign-out ended the user's sessions everywhere ----------
describe("sign-out ends only this phone's session", () => {
  it("signs out with scope local: the default 'global' also signs out the user's other phones, which stay bound to their push tokens", async () => {
    h.state.secure.set("push-expo-token", TOKEN);
    const push = await import("../src/lib/push");
    await push.signOutAndUnbindPush();
    expect(h.state.deletes).toHaveLength(1); // this phone's row first, while RLS allows it
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

// ---------- LOW #1: logout failed after the token row was already deleted ----------
describe("a sign-out that fails after the token row was deleted", () => {
  it("binds this phone's token again: the user is still signed in and keeps order notifications", async () => {
    h.state.secure.set("push-expo-token", TOKEN);
    h.state.signOutResult = GOTRUE_DOWN;
    const push = await import("../src/lib/push");
    await expect(push.signOutAndUnbindPush()).rejects.toThrow(push.SIGN_OUT_FAILED);
    expect(h.state.deletes).toHaveLength(1);
    expect(h.rpc).toHaveBeenCalledWith("register_device_push_token", { p_token: TOKEN, p_platform: "android" });
    expect(h.state.secure.get("push-expo-token")).toBe(TOKEN); // the next sign-out unbinds it again
  });

  it("if it can't be bound again either, the user is told notifications are off (Romanian)", async () => {
    h.state.secure.set("push-expo-token", TOKEN);
    h.state.signOutResult = GOTRUE_DOWN;
    h.state.rpcError = { message: "Network request failed", code: "" };
    const push = await import("../src/lib/push");
    const err = await push.signOutAndUnbindPush().then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/notificările/);
    expect(err?.message).toMatch(/[ăâîșț]/);
    expect(err?.message).not.toMatch(/Network|fetch|upstream/);
  });

  it("a phone that never had a token gets the plain message (no push to restore)", async () => {
    h.state.tokenError = new Error("Default FirebaseApp is not initialized");
    h.state.signOutResult = GOTRUE_DOWN;
    const push = await import("../src/lib/push");
    await expect(push.signOutAndUnbindPush()).rejects.toThrow(push.SIGN_OUT_FAILED);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

// ---------- LOW #4: hours read cut at max_rows → open restaurants shown closed ----------
describe("restaurant list hours survive PostgREST max_rows", () => {
  it("150 restaurants × 7 hours rows (1050 > 1000): every restaurant open all week is shown open", async () => {
    const id = (i: number) => `r${String(i).padStart(3, "0")}`;
    h.state.restaurants = Array.from({ length: 150 }, (_, i) => ({
      id: id(i), slug: id(i), name: `R ${id(i)}`, cuisine_type: "sushi", venue_type: "restaurant", address: "", lat: null, lng: null,
      logo_url: null, cover_photo_url: null, rating_avg: null, rating_count: 0, avg_prep_minutes: 30, delivery_fee_mdl: 30,
      min_order_amount_mdl: 100, accepting_orders: true, accepts_catering: false, catering_min_amount_mdl: null,
    }));
    h.state.hours = h.state.restaurants.flatMap((r) =>
      Array.from({ length: 7 }, (_, d) => ({ restaurant_id: r.id as string, day_of_week: d, opens_at: "00:00:00", closes_at: "24:00:00", is_closed: false })),
    );
    const { fetchRestaurants } = await import("../src/lib/api");
    const list = await fetchRestaurants();
    expect(list).toHaveLength(150);
    expect(list.filter((r) => !r.openNow).map((r) => r.id)).toEqual([]);
  });
});

// Verifier round 2: auth-js clears the local session AFTER the server call; when that throws
// (Android keystore), signOut rejects instead of returning { error } and the Profile alert showed
// the raw English text. It is reported in Romanian, and the token is not bound again.
describe("a sign-out that throws while clearing the local session", () => {
  it("is reported in Romanian, never as the raw storage error", async () => {
    h.state.secure.set("push-expo-token", TOKEN);
    h.signOut.mockImplementationOnce(async () => {
      throw new Error("Could not delete item from keystore");
    });
    const push = await import("../src/lib/push");
    const err = await push.signOutAndUnbindPush().then(() => null, (e: Error) => e);
    expect(err?.message).toBe(push.SIGN_OUT_FAILED);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
