import { beforeEach, describe, expect, it, vi } from "vitest";

// advanceOrEnqueue (the swipe) against a fake advance_delivery_status.
const h = vi.hoisted(() => ({
  status: "cancelled",
  visible: true, // false = RLS hides the order (reassigned to another courier)
  session: true, // false = the session lapsed: the client refuses the read (an anon one would see no row)
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

// PostgREST on 0 rows: .single() errors (PGRST116), .maybeSingle() returns null. With no session
// the app's client does not send the read at all: it answers "network: no courier session".
const zeroRows = { code: "PGRST116", message: "Cannot coerce the result to a single JSON object", details: "The result contains 0 rows", hint: null };
vi.mock("../src/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => (h.visible ? { data: { status: h.status }, error: null } : { data: null, error: zeroRows }),
          maybeSingle: async () =>
            h.session
              ? { data: h.visible ? { status: h.status } : null, error: null }
              : { data: null, error: { message: "network: no courier session" } },
        }),
      }),
    }),
    rpc: async () => ({ error: null }),
  },
}));

const { advanceOrEnqueue } = await import("../src/lib/offlineQueue");

beforeEach(() => {
  Object.assign(h, { status: "cancelled", visible: true, session: true, connected: true, failGet: false });
  h.store.clear();
});

describe("an order reassigned to another courier (MED)", () => {
  it("the swipe closes the screen with its own Romanian message, not the generic retry forever", async () => {
    h.status = "en_route";
    h.visible = false; // admin_reassign_courier: the old courier no longer sees the row
    const r = await advanceOrEnqueue("o1", "delivered", true);
    expect(r).toEqual({ error: "Comanda nu-ți mai este alocată — a fost reatribuită altui curier.", queued: false, closed: true });
  });

  it("a lapsed session (row hidden, no session) is NOT a reassignment: the swipe is queued, the screen stays", async () => {
    h.status = "en_route";
    h.visible = false;
    h.session = false;
    const r = await advanceOrEnqueue("o1", "delivered", true);
    expect(r.closed).toBeFalsy();
    expect(r.queued).toBe(true);
  });
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
