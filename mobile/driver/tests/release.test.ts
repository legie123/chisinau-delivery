import { describe, expect, it, vi } from "vitest";

// Courier releases an accepted order before pickup (RPC courier_release_order, migration 20261012000209).
const h = vi.hoisted(() => ({ calls: [] as unknown[], data: 2 as unknown, error: null as null | { code: string; message: string } }));
vi.mock("../src/lib/backgroundLocation", () => ({ stopDeliveryTracking: async () => undefined }));
vi.mock("../src/lib/push", () => ({ unregisterPush: async () => undefined, registerForPush: async () => null }));
vi.mock("../src/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (fn: string, args: unknown) => (h.calls.push([fn, args]), { data: h.data, error: h.error }),
  },
}));

const api = await import("../src/lib/api");
const { RELEASE_REASONS, releaseVisible, releaseOrderFlow } = await import("../src/lib/release");
const { releaseOrder } = await import("@chisinau/shared-api");

describe("api.releaseOrder", () => {
  it("sends this order and reason, returns how many releases are left today", async () => {
    h.calls = []; h.data = 2; h.error = null;
    expect(await api.releaseOrder("o1", "vehicle_problem")).toEqual({ error: null, left: 2 });
    expect(h.calls).toEqual([["courier_release_order", { p_order_id: "o1", p_reason: "vehicle_problem" }]]);
  });
  it("the server's Romanian refusal reaches the courier (cap reached, after pickup)", async () => {
    h.error = { code: "P0001", message: "Ai atins limita de 3 renunțări pe azi. Sună la suport." };
    expect(await api.releaseOrder("o1", "other")).toEqual({ error: "Ai atins limita de 3 renunțări pe azi. Sună la suport.", left: null });
  });
  it("shared-api returns the RPC's number as is", async () => {
    const db = { rpc: async () => ({ data: 0, error: null }) } as never;
    expect(await releaseOrder(db, "o1" as never, "other")).toBe(0);
  });
});

describe("release flow", () => {
  const deps = (over = {}) => {
    const log: string[] = [];
    return {
      log,
      deps: {
        release: async () => ({ error: null as string | null, left: 1 as number | null }),
        stopGps: async () => void log.push("stopGps"),
        alert: (t: string, m: string) => void log.push(`alert:${t}:${m}`),
        leave: () => void log.push("leave"),
        ...over,
      },
    };
  };
  it("success: GPS stops, the courier is told how many are left, the screen closes", async () => {
    const { deps: d, log } = deps();
    await releaseOrderFlow("o1", "vehicle_problem", d);
    expect(log).toEqual(["stopGps", "alert:Ai renunțat la comandă:Comanda merge la alt curier. Îți mai rămân 1 renunțări azi.", "leave"]);
  });
  it("refused: told why, GPS keeps running, the screen stays", async () => {
    const { deps: d, log } = deps({ release: async () => ({ error: "Comanda e deja ridicată: renunțarea se face doar prin suport.", left: null }) });
    await releaseOrderFlow("o1", "other", d);
    expect(log).toEqual(["alert:Nu ai putut renunța:Comanda e deja ridicată: renunțarea se face doar prin suport."]);
  });
  it("only on the pickup leg", () => {
    expect(releaseVisible("pickup")).toBe(true);
    expect(releaseVisible("delivering")).toBe(false);
    expect(releaseVisible("delivered")).toBe(false);
  });
  it("the four reasons the server accepts, each with a Romanian label", () => {
    expect(Object.keys(RELEASE_REASONS).sort()).toEqual(["other", "personal_emergency", "restaurant_delay", "vehicle_problem"]);
    for (const label of Object.values(RELEASE_REASONS)) expect(label).toMatch(/[a-zăâîșț]/i);
  });
});

describe("wiring (the screen passes the real values through)", async () => {
  const { readFileSync } = await import("node:fs");
  const s = readFileSync(new URL("../src/screens/ActiveDeliveryScreen.tsx", import.meta.url), "utf8");
  it("button only via releaseVisible(status); the chosen reason goes through releaseOrderFlow with the real deps", () => {
    expect(s).toMatch(/\{releaseVisible\(status\) && \(/);
    expect(s).toMatch(/releaseOrderFlow\(order\.id, reason, \{\s*release: releaseOrder,\s*stopGps,/);
    expect(s).toMatch(/leave: \(\) => navigation\.goBack\(\),/);
  });
});
