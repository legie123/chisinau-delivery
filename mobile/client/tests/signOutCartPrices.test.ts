// Adversarial round on the client-native fixes. Native modules are stubbed; the
// app's own push.ts and shared-domain reconcileLines run for real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CART, addToCart, chosenOptions } from "@chisinau/shared-domain";

const h = vi.hoisted(() => {
  const state = {
    deleteError: null as null | { message: string },
    deletes: [] as unknown[][][],
    secure: new Map<string, string>(),
    tokenError: null as null | Error,
    signOutResult: { error: null } as { error: null | { name: string; message: string } },
  };
  const signOut = vi.fn(async () => state.signOutResult);
  const builder = () => {
    const filters: unknown[][] = [];
    const q = {
      delete: () => q,
      eq: (...a: unknown[]) => (filters.push(["eq", ...a]), q),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        state.deletes.push(filters);
        return Promise.resolve({ data: null, error: state.deleteError }).then(res, rej);
      },
    };
    return q;
  };
  const supabase = { from: () => builder(), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }), signOut } };
  return { state, signOut, supabase };
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

beforeEach(() => {
  vi.resetModules();
  h.state.deleteError = null;
  h.state.deletes = [];
  h.state.secure.clear();
  h.state.tokenError = null;
  h.state.signOutResult = { error: null };
  h.signOut.mockClear();
});

describe("sign-out can always finish", () => {
  it("a phone that can never produce a push token (no FCM / Expo Go on Android / no Google services) still signs out", async () => {
    // registerForPush failed the same way at sign-in, so nothing was bound or stored.
    h.state.tokenError = new Error("Default FirebaseApp is not initialized in this process md.dragonsdelivery.client.");
    const push = await import("../src/lib/push");
    expect(await push.registerForPush()).toBe("error");
    await push.signOutAndUnbindPush();
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.state.deletes).toHaveLength(0);
  });

  it("a token this phone DID bind still blocks sign-out while its delete fails (guarantee kept)", async () => {
    h.state.secure.set("push-expo-token", "ExponentPushToken[abc]");
    h.state.deleteError = { message: "Network request failed" };
    const push = await import("../src/lib/push");
    await expect(push.signOutAndUnbindPush()).rejects.toThrow(/notificările/);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("a logout request that fails (offline) is reported in Romanian, never shown as signed out", async () => {
    // supabase-js resolves { error: AuthRetryableFetchError } and KEEPS the session.
    h.state.signOutResult = { error: { name: "AuthRetryableFetchError", message: "Network request failed" } };
    const push = await import("../src/lib/push");
    const err = await push.signOutAndUnbindPush().then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/[ăâîșț]/);
    expect(err!.message).not.toMatch(/Network|fetch/);
  });
});

describe("cart reconciliation does not invent price changes", () => {
  const r = { id: "r1", name: "Sakura" };
  const ref = { id: "m1", name: "Philadelphia", price_mdl: 19.9 };
  const group = {
    id: "g1", name: "Sos", is_required: true, min_select: 1, max_select: 1,
    options: [{ id: "o1", name: "Spicy", price_delta_mdl: 0.7, is_available: true }],
  };

  it("an unchanged line with decimal prices is not 'repriced' (cart 20.599999999999998 vs live 20.60)", async () => {
    const { reconcileLines } = await import("@chisinau/shared-domain");
    const cart = addToCart(EMPTY_CART, r, ref, chosenOptions(ref, [group], { g1: ["o1"] }), 2);
    const live = reconcileLines(cart.lines, [{ id: "m1", price_mdl: 19.9, is_available: true }], [{ id: "o1", price_delta_mdl: 0.7, is_available: true }]);
    expect(live.repriced).toEqual([]);
    expect(live.lines[0]).toBe(cart.lines[0]); // line kept as is, no setCart churn
  });

  it("a real change is reported with clean MDL amounts", async () => {
    const { reconcileLines } = await import("@chisinau/shared-domain");
    const cart = addToCart(EMPTY_CART, r, ref, chosenOptions(ref, [group], { g1: ["o1"] }), 2);
    const live = reconcileLines(cart.lines, [{ id: "m1", price_mdl: 21.9, is_available: true }], [{ id: "o1", price_delta_mdl: 0.7, is_available: true }]);
    expect(live.repriced).toEqual([{ lineId: cart.lines[0].lineId, name: "Philadelphia", from: 20.6, to: 22.6 }]);
  });
});
