import { beforeEach, describe, expect, it, vi } from "vitest";

// src/lib/api.ts with Supabase faked: who may sign in, what sign-out reports,
// and that a failed commission read is never pinned for 5 minutes.
const h = vi.hoisted(() => ({
  signInError: null as { message: string } | null,
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  courierRow: { id: "c1" } as { id: string } | null,
  onlineError: null as { code: string; message: string } | null,
  pricing: [] as ({ data: unknown; error: unknown })[],
  signOutCalls: 0,
  stopFails: false,
  unregisterFails: false,
  calls: [] as string[], // the steps sign-out cannot undo
  history: [] as unknown[],
  delivered: [] as unknown[],
}));

vi.mock("../src/lib/backgroundLocation", () => ({
  stopDeliveryTracking: async () => {
    h.calls.push("stopGPS");
    if (h.stopFails) throw new Error("stop failed");
  },
}));
vi.mock("../src/lib/push", () => ({
  unregisterPush: async () => {
    h.calls.push("deletePushToken");
    if (h.unregisterFails) throw new TypeError("Network request failed");
  },
}));
vi.mock("../src/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: async () => ({ error: h.signInError }),
      getSession: async () => ({ data: { session: h.session } }),
      signOut: async () => {
        h.signOutCalls++;
        h.session = null;
        return { error: null };
      },
    },
    from: (table: string) => {
      if (table === "couriers") return { select: () => ({ maybeSingle: async () => ({ data: h.courierRow, error: null }) }) };
      // orders: any chain of filters, resolves to the delivered rows
      const b: Record<string, unknown> = {};
      for (const op of ["select", "eq", "gte", "lt", "order", "limit"]) b[op] = () => b;
      b.then = (resolve: (v: unknown) => void) => resolve({ data: h.delivered, error: null });
      return b;
    },
    rpc: async (fn: string) => {
      if (fn === "set_courier_online_status") return { error: h.onlineError };
      if (fn === "current_pricing_config") return h.pricing.shift() ?? { data: null, error: { message: "boom" } };
      if (fn === "public_pricing_history") return { data: h.history, error: null };
      return { data: null, error: null };
    },
  },
}));

const api = await import("../src/lib/api");
const restore = () => (api as Record<string, unknown>).restoreCourierSession as () => Promise<boolean>;

beforeEach(() => {
  Object.assign(h, {
    signInError: null,
    session: { user: { id: "u1" } },
    courierRow: { id: "c1" },
    onlineError: null,
    pricing: [],
    signOutCalls: 0,
    stopFails: false,
    unregisterFails: false,
    calls: [],
  });
});

describe("only couriers get into the courier app (LOW e)", () => {
  it("a customer account is refused in Romanian and signed out again (no push token, no '…' forever)", async () => {
    h.courierRow = null;
    h.session = { user: { id: "customer-1" } };
    const msg = await api.signIn("client@test.md", "parola123");
    expect(msg).toMatch(/nu este de curier/);
    expect(h.signOutCalls).toBe(1);
  });

  it("a courier signs in", async () => {
    h.session = { user: { id: "courier-2" } };
    expect(await api.signIn("curier@test.md", "parola123")).toBeNull();
    expect(h.signOutCalls).toBe(0);
  });

  it("wrong password → Romanian, never GoTrue's English", async () => {
    h.signInError = { message: "Invalid login credentials" };
    expect(await api.signIn("x@y.md", "nope")).toBe("Autentificare eșuată. Verifică emailul și parola.");
  });

  it("a stored non-courier session is dropped at app start", async () => {
    expect(typeof restore()).toBe("function");
    h.courierRow = null;
    h.session = { user: { id: "customer-3" } };
    expect(await restore()()).toBe(false);
    expect(h.signOutCalls).toBe(1);
  });
});

describe("sign-out failures are surfaced, not console.warn'ed (LOW a)", () => {
  it("offline: set-offline fails → Romanian message, session KEPT, GPS and push token left running", async () => {
    h.session = { user: { id: "courier-4" } };
    h.onlineError = { code: "", message: "TypeError: Network request failed" };
    const msg = await api.signOut();
    expect(msg).toMatch(/Deconectarea nu e completă/);
    expect(h.calls).toEqual([]);
    expect(h.signOutCalls).toBe(0);
  });

  it("offline after going offline: the push token cannot be deleted → said, session KEPT", async () => {
    h.unregisterFails = true;
    const msg = await api.signOut();
    expect(msg).toMatch(/notificările/);
    expect(h.signOutCalls).toBe(0);
  });

  it("during a delivery (MED): the server refuses offline → GPS and push token untouched, session kept, the real reason", async () => {
    h.onlineError = { code: "P0001", message: "ai o livrare activă — finalizeaz-o înainte să schimbi statusul" };
    const msg = await api.signOut();
    expect(msg).toMatch(/ai o livrare activă/);
    expect(msg).not.toMatch(/semnal/); // not blamed on the network
    expect(h.calls).toEqual([]); // the customer's live map and the offer pushes keep working
    expect(h.signOutCalls).toBe(0);
  });

  it("„Deconectează oricum” (force) signs out despite the failures", async () => {
    h.onlineError = { code: "", message: "TypeError: Network request failed" };
    expect(await api.signOut(true)).toBeNull();
    expect(h.calls).toEqual(["stopGPS", "deletePushToken"]);
    expect(h.signOutCalls).toBe(1);
  });

  it("all steps OK → signed out, no message", async () => {
    expect(await api.signOut()).toBeNull();
    expect(h.signOutCalls).toBe(1);
  });
});

describe("history screen settles each order at its own pricing version (MED money)", () => {
  it("rows delivered under 15% keep 15% after the switch to 20%; the 20% one uses 20%", async () => {
    h.session = { user: { id: "courier-5" } };
    h.history = [
      { effective_from: "2026-01-01T00:00:00+00:00", courier_pct: 15 },
      { effective_from: "2026-10-01T00:00:00+00:00", courier_pct: 20 },
    ];
    h.pricing = [{ data: { courier_commission_pct: 20 }, error: null }]; // the live rate is already 20
    h.delivered = [
      { id: "a", order_number: "CHD-2026-000023", delivered_at: "2026-09-29T10:00:00Z", updated_at: "2026-09-29T10:00:00Z", delivery_fee_mdl: 45, courier_fee_mdl: null, tip_mdl: 0, payment_status: "paid", restaurants: null },
      { id: "b", order_number: "CHD-2026-000476", delivered_at: "2026-09-30T18:00:00Z", updated_at: "2026-09-30T18:00:00Z", delivery_fee_mdl: 45, courier_fee_mdl: 30.74, tip_mdl: 0, payment_status: "paid", restaurants: null },
      { id: "c", order_number: "CHD-2026-000900", delivered_at: "2026-10-02T12:00:00Z", updated_at: "2026-10-02T12:00:00Z", delivery_fee_mdl: 40, courier_fee_mdl: null, tip_mdl: 0, payment_status: "paid", restaurants: null },
    ];
    const { rows } = await api.fetchDeliveryHistory();
    expect(rows.map((r) => r.netMdl)).toEqual([38.25, 26.13, 32]); // payout lines (verifier: app showed 36 / 24.59)
  });
});

describe("a failed commission read is not cached (LOW d)", () => {
  it("RPC error → default for this call only; the next call reads the real rate", async () => {
    h.pricing = [
      { data: null, error: { message: "JWT expired" } },
      { data: { courier_commission_pct: 20 }, error: null },
    ];
    expect(await api.getCommissionPct()).toBe(15);
    expect(await api.getCommissionPct()).toBe(20);
  });
});
