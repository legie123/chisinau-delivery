import { beforeEach, describe, expect, it, vi } from "vitest";

// "Accept comenzi cu numerar" (ProfileScreen): src/lib/api.ts with PostgREST faked at the wire —
// what is read from couriers.accepts_cash, what set_courier_accepts_cash is sent, and the Romanian
// text the courier sees for each way the server can refuse.
const h = vi.hoisted(() => ({
  row: { accepts_cash: true } as Record<string, unknown> | null,
  readError: null as { message: string } | null,
  rpcError: null as { code: string; message: string } | null,
  calls: [] as { fn: string; args: unknown }[],
  selected: [] as string[],
}));

vi.mock("../src/lib/backgroundLocation", () => ({ stopDeliveryTracking: async () => undefined }));
vi.mock("../src/lib/push", () => ({ unregisterPush: async () => undefined, registerForPush: async () => null }));
vi.mock("../src/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => {
        h.selected.push(`${table}:${cols}`);
        return { maybeSingle: async () => ({ data: h.row, error: h.readError }) };
      },
    }),
    rpc: async (fn: string, args: unknown) => {
      h.calls.push({ fn, args });
      return { data: h.rpcError ? null : (args as { p_accepts: boolean }).p_accepts, error: h.rpcError };
    },
  },
}));

const { fetchMyAcceptsCash, setMyAcceptsCash } = await import("../src/lib/api");
const { changeAcceptsCash, cashPreferenceHint } = await import("../src/lib/profileMenu");

beforeEach(() => {
  Object.assign(h, { row: { accepts_cash: true }, readError: null, rpcError: null, calls: [], selected: [] });
});

describe("fetchMyAcceptsCash reads the courier's own row", () => {
  it("maps couriers.accepts_cash", async () => {
    expect(await fetchMyAcceptsCash()).toBe(true);
    h.row = { accepts_cash: false };
    expect(await fetchMyAcceptsCash()).toBe(false);
    expect(h.selected).toEqual(["couriers:accepts_cash", "couriers:accepts_cash"]);
  });
  it("no courier row (or no column) -> null, the row is hidden instead of showing a made-up value", async () => {
    h.row = null;
    expect(await fetchMyAcceptsCash()).toBeNull();
    h.row = { id: "c1" };
    expect(await fetchMyAcceptsCash()).toBeNull();
  });
  it("a failed read throws (the screen shows 'Profilul nu s-a încărcat')", async () => {
    h.readError = { message: "boom" };
    await expect(fetchMyAcceptsCash()).rejects.toThrow("boom");
  });
});

describe("setMyAcceptsCash calls set_courier_accepts_cash and answers in Romanian", () => {
  it("sends the new value, null on success", async () => {
    expect(await setMyAcceptsCash(false)).toBeNull();
    expect(h.calls).toEqual([{ fn: "set_courier_accepts_cash", args: { p_accepts: false } }]);
  });
  it("the server's Romanian refusal during a delivery reaches the courier as is", async () => {
    const msg = "Nu poți schimba preferința pentru numerar în timpul unei livrări. Termină livrarea întâi.";
    h.rpcError = { code: "P0001", message: msg };
    expect(await setMyAcceptsCash(true)).toBe(msg);
  });
  it("no execute right (anon / view-as) -> Romanian permission text, never the raw one", async () => {
    h.rpcError = { code: "42501", message: "permission denied for function set_courier_accepts_cash" };
    expect(await setMyAcceptsCash(true)).toBe("Nu ai permisiunea pentru această acțiune.");
  });
  it("no signal -> says so, not a generic error", async () => {
    h.rpcError = { code: "", message: "TypeError: Network request failed" };
    expect(await setMyAcceptsCash(true)).toBe("Fără conexiune — încearcă din nou când ai semnal.");
  });
});

describe("the switch moves only when the server agreed", () => {
  it("success -> applies the new value, no alert", async () => {
    const applied: boolean[] = [];
    const failed: string[] = [];
    await changeAcceptsCash(false, { save: setMyAcceptsCash, apply: (v) => applied.push(v), fail: (m) => failed.push(m) });
    expect(applied).toEqual([false]);
    expect(failed).toEqual([]);
  });
  it("refusal -> keeps the old value and shows the Romanian reason", async () => {
    h.rpcError = { code: "P0001", message: "Nu poți schimba preferința pentru numerar în timpul unei livrări. Termină livrarea întâi." };
    const applied: boolean[] = [];
    const failed: string[] = [];
    await changeAcceptsCash(true, { save: setMyAcceptsCash, apply: (v) => applied.push(v), fail: (m) => failed.push(m) });
    expect(applied).toEqual([]);
    expect(failed).toEqual(["Nu poți schimba preferința pentru numerar în timpul unei livrări. Termină livrarea întâi."]);
  });
  it("the hint says what each position means", () => {
    expect(cashPreferenceHint(true)).toBe("Primești și comenzi plătite cu numerar.");
    expect(cashPreferenceHint(false)).toMatch(/^Nu primești comenzi cu numerar\. Comenzile plătite cu cardul/);
  });
});

describe("ProfileScreen really uses it (not built-and-never-called)", () => {
  it("loads the value on focus and saves through changeAcceptsCash", async () => {
    const { readFileSync } = await import("node:fs");
    const s = readFileSync(new URL("../src/screens/ProfileScreen.tsx", import.meta.url), "utf8");
    expect(s).toMatch(/fetchMyAcceptsCash\(\)\]\)/);
    expect(s).toMatch(/changeAcceptsCash\(next, \{\s*save: setMyAcceptsCash/);
    expect(s).toContain("Accept comenzi cu numerar");
  });
});
