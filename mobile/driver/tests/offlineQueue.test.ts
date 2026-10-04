import { beforeEach, describe, expect, it, vi } from "vitest";

// advanceOrEnqueue (the swipe) against a fake advance_delivery_status.
const h = vi.hoisted(() => ({
  status: "cancelled",
  connected: true,
  failGet: false,
  store: new Map<string, string>(),
}));

vi.mock("expo-network", () => ({ getNetworkStateAsync: async () => ({ isConnected: h.connected }) }));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => {
      if (h.failGet) throw new Error("AsyncStorage: transient");
      return h.store.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => void h.store.set(k, v),
    removeItem: async (k: string) => void h.store.delete(k),
  },
}));

vi.mock("../src/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { status: h.status }, error: null }) }) }) }),
    rpc: async () => ({ error: null }),
  },
}));

const { advanceOrEnqueue } = await import("../src/lib/offlineQueue");

beforeEach(() => {
  Object.assign(h, { status: "cancelled", connected: true, failGet: false });
  h.store.clear();
});

describe("a cancelled order on ActiveDelivery (LOW b)", () => {
  it("says 'Comanda a fost anulată' and asks the screen to close, instead of the generic network-looking error", async () => {
    const r = await advanceOrEnqueue("o1", "delivered", true);
    expect(r).toEqual({ error: "Comanda a fost anulată.", queued: false, closed: true });
  });

  it("an order already advanced elsewhere also closes, with its own Romanian message", async () => {
    h.status = "delivered";
    const r = await advanceOrEnqueue("o1", "en_route");
    expect(r.closed).toBe(true);
    expect(r.error).toMatch(/deja actualizată/);
  });
});

describe("the queue's new enqueue refusal never escapes as a throw", () => {
  it("offline + storage read failure → a Romanian error, not an unhandled rejection", async () => {
    h.connected = false;
    h.failGet = true;
    const r = await advanceOrEnqueue("o1", "delivered", true);
    expect(r.queued).toBe(false);
    expect(r.error).toMatch(/Nu am putut salva acțiunea offline/);
  });
});
