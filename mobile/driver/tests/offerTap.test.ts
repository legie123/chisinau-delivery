import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// MED: tapping an offer push did nothing — the app came back on whatever tab was
// open (Câștiguri/Comenzi/Profil), the 30s offer expired unseen and counted as
// ignored (3 → auto-offline).
const resp = (id: string, data: Record<string, unknown> | null) => ({
  notification: { request: { identifier: id, content: { data } } },
});

function fakeNotifications(cold: ReturnType<typeof resp> | null = null) {
  let listener: ((r: ReturnType<typeof resp>) => void) | null = null;
  const src = {
    last: cold,
    addNotificationResponseReceivedListener: vi.fn((l: typeof listener) => {
      listener = l;
      return { remove: vi.fn(() => (listener = null)) };
    }),
    getLastNotificationResponse: () => src.last,
    clearLastNotificationResponse: vi.fn(() => {
      src.last = null;
    }),
    tap: (r: ReturnType<typeof resp>) => listener?.(r),
    listening: () => listener !== null,
  };
  return src;
}

async function load() {
  return import("../src/lib/offerTap");
}

describe("offer push tap → Map tab + immediate refetch", () => {
  it("a warm tap on an offer push fires; other pushes do not", async () => {
    const { watchOfferTaps } = await load();
    const n = fakeNotifications();
    const onOffer = vi.fn();
    const stop = watchOfferTaps(n, onOffer);
    n.tap(resp("a", { url: "/deliveries", tag: "offer:123" }));
    n.tap(resp("b", { url: "/orders/x", tag: "order-x" }));
    n.tap(resp("c", null));
    expect(onOffer).toHaveBeenCalledTimes(1);
    stop();
    expect(n.listening()).toBe(false);
  });

  it("the tap that cold-started the app fires once, is cleared, and is not replayed by the listener", async () => {
    const { watchOfferTaps } = await load();
    const cold = resp("cold-1", { tag: "offer:9" });
    const n = fakeNotifications(cold);
    const onOffer = vi.fn();
    watchOfferTaps(n, onOffer);
    n.tap(cold); // some platforms also deliver the launch response to the listener
    expect(onOffer).toHaveBeenCalledTimes(1);
    expect(n.clearLastNotificationResponse).toHaveBeenCalled();
    watchOfferTaps(n, onOffer); // remount after sign-out → sign-in
    expect(onOffer).toHaveBeenCalledTimes(1);
  });

  it("App.tsx wires it: navigation ref, Map tab with a fresh param; MapScreen refetches on that param", () => {
    const root = path.resolve(__dirname, "..");
    const app = readFileSync(path.join(root, "App.tsx"), "utf8");
    expect(app).toMatch(/onOfferTapped\(/);
    expect(app).toMatch(/<NavigationContainer ref=\{navRef\} onReady=\{flushOfferTap\}>/);
    expect(app).toMatch(/navRef\.navigate\('Main', \{ screen: 'Map', params: \{ offerTapAt: Date\.now\(\) \} \}, \{ pop: true \}\)/);
    const map = readFileSync(path.join(root, "src/screens/MapScreen.tsx"), "utf8");
    expect(map).toMatch(/if \(offerTapAt\) void refreshOffer\(\);/);
  });

  it("from a stale ActiveDelivery the tap goes BACK to the Main tabs, not a second MainTabs on top (LOW)", async () => {
    // The app's own stack (App.tsx: Main + ActiveDelivery) on React Navigation 7's real StackRouter.
    const { StackRouter, CommonActions } = await import("@react-navigation/routers");
    const router = StackRouter({});
    const options = { routeNames: ["Main", "ActiveDelivery"], routeParamList: {}, routeGetIdList: {} };
    const stale = router.getStateForAction(
      router.getInitialState(options),
      CommonActions.navigate("ActiveDelivery", { order: { id: "o1" } }),
      options,
    )!;
    const tap = { screen: "Map", params: { offerTapAt: 1 } };
    // navigate(name, params) PUSHES in v7: a second MapScreen polling, the dead order kept underneath.
    const pushed = router.getStateForAction(stale, CommonActions.navigate("Main", tap), options)!;
    expect(pushed.routes.map((r) => r.name)).toEqual(["Main", "ActiveDelivery", "Main"]);
    // { pop: true } — what App.tsx passes — returns to the Main already at the bottom.
    const popped = router.getStateForAction(stale, CommonActions.navigate("Main", tap, { pop: true }), options)!;
    expect(popped.routes.map((r) => r.name)).toEqual(["Main"]);
    expect(popped.routes[0].key).toBe(stale.routes[0].key);
    expect(popped.routes[0].params).toEqual(tap); // its tab navigator opens Map with the fresh offerTapAt
  });

  it("an offer tapped on ActiveDelivery opens the offer unless the server still has a delivery on his hands (LOW)", () => {
    const app = readFileSync(path.join(path.resolve(__dirname, ".."), "App.tsx"), "utf8");
    // not on ActiveDelivery → straight to the offer
    expect(app).toMatch(/if \(navRef\.getCurrentRoute\(\)\?\.name !== 'ActiveDelivery'\) return toOffer\(\);/);
    // on it → only when the server has no active order (a screen left open after a cancel/reassign)
    expect(app).toMatch(/hasActiveDelivery\(\)\.then\(\(active\) => \{\s*if \(!active\) toOffer\(\);/);
  });
});
