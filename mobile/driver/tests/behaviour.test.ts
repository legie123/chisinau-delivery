import { beforeEach, describe, expect, it, vi } from "vitest";

// Behaviour, not source text (verif-curier-g4: 17 mutants survived regex wiring tests). src/lib/api.ts runs
// against a faked Supabase that RECORDS what it is asked, in order.
const h = vi.hoisted(() => ({
  calls: [] as { op: string; args: unknown[] }[],
  uploadError: null as null | { message: string; statusCode?: number },
  rpcData: {} as Record<string, unknown>,
  rpcError: {} as Record<string, null | { code: string; message: string }>,
}));

vi.mock("../src/lib/backgroundLocation", () => ({ stopDeliveryTracking: async () => undefined }));
vi.mock("../src/lib/push", () => ({ unregisterPush: async () => undefined, registerForPush: async () => null }));
vi.mock("../src/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _body: unknown, opts: unknown) => {
          h.calls.push({ op: "upload", args: [bucket, path, opts] });
          return { error: h.uploadError };
        },
      }),
    },
    rpc: async (fn: string, args: unknown) => {
      h.calls.push({ op: `rpc:${fn}`, args: [args] });
      return { data: h.rpcData[fn] ?? null, error: h.rpcError[fn] ?? null };
    },
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const op of ["select", "eq", "order", "limit"]) {
        b[op] = (...args: unknown[]) => (h.calls.push({ op: `${table}.${op}`, args }), b);
      }
      b.maybeSingle = async () => ({ data: { iban: "MD24AG000225100013104168", holder_name: "Ion" }, error: null });
      return b;
    },
  },
}));

const api = await import("../src/lib/api");
const { reportDeliveryIssue } = await import("@chisinau/shared-api");
const { describeReport, ISSUE_LABELS } = await import("../src/lib/issues");
const { CAMERA_OPTIONS, proofButtonVisible } = await import("../src/lib/deliveryProof");
const { submitPayout, payoutSummary } = await import("../src/lib/iban");
const { runMenuAction } = await import("../src/lib/profileMenu");
const { historyExtraLines, historyTipLabel } = await import("../src/lib/earnings");
const { readSupportPhone } = await import("../src/lib/config");
const { default: config } = await import("../app.config");

beforeEach(() => {
  h.calls = [];
  h.uploadError = null;
  h.rpcData = {};
  h.rpcError = {};
  vi.stubGlobal("fetch", async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }));
});

describe("issue report", () => {
  it("api.reportIssue sends THIS kind for THIS order and reports new vs repeat from the RPC's answer", async () => {
    h.rpcData.courier_report_issue = true;
    expect(await api.reportIssue("o1", "address_wrong")).toEqual({ error: null, isNew: true });
    expect(h.calls).toEqual([{ op: "rpc:courier_report_issue", args: [{ p_order_id: "o1", p_kind: "address_wrong" }] }]);
    h.rpcData.courier_report_issue = false;
    expect((await api.reportIssue("o1", "running_late")).isNew).toBe(false);
  });
  it("shared-api reportDeliveryIssue is true only when the RPC says true", async () => {
    for (const [data, want] of [[true, true], [false, false], [null, false]] as const) {
      const db = { rpc: async () => ({ data, error: null }) } as never;
      expect(await reportDeliveryIssue(db, "o1" as never, "running_late")).toBe(want);
    }
  });
  it("an RPC error becomes the Romanian message, never isNew", async () => {
    h.rpcError.courier_report_issue = { code: "P0001", message: "Comanda nu îți este atribuită." };
    expect(await api.reportIssue("o1", "running_late")).toEqual({ error: "Comanda nu îți este atribuită.", isNew: false });
  });
  it("what the screen shows: the kind's own label, new and repeat differ", () => {
    expect(ISSUE_LABELS).toEqual({
      running_late: "Întârzii",
      restaurant_delayed: "Comanda nu e gata la restaurant",
      venue_not_found: "Nu găsesc restaurantul",
      customer_unreachable: "Clientul nu răspunde",
      address_wrong: "Adresa e greșită sau incompletă",
    });
    expect(describeReport("customer_unreachable", true).title).toBe("Clientul nu răspunde");
    expect(describeReport("running_late", true).text).not.toBe(describeReport("running_late", false).text);
  });
});

describe("proof photo", () => {
  it("uploads FIRST under the order's folder, then attaches that same path", async () => {
    expect(await api.uploadDeliveryProof("o1", "file:///x.jpg")).toBeNull();
    expect(h.calls.map((c) => c.op)).toEqual(["upload", "rpc:attach_delivery_proof"]);
    const path = h.calls[0].args[1] as string;
    expect(path).toMatch(/^o1\/\d+-[a-z0-9]+\.jpg$/);
    expect(h.calls[0].args[0]).toBe("delivery-proof");
    expect(h.calls[1].args[0]).toEqual({ p_order_id: "o1", p_path: path });
  });
  it("a failed upload is reported and NEVER attached", async () => {
    h.uploadError = { message: "Payload too large", statusCode: 413 };
    expect(await api.uploadDeliveryProof("o1", "file:///x.jpg")).toBe("Fișierul e prea mare.");
    expect(h.calls.map((c) => c.op)).toEqual(["upload"]);
  });
  it("camera options: JPEG at 0.4, no editing, EXIF not handed to JS", () => {
    expect(CAMERA_OPTIONS).toEqual({ mediaTypes: ["images"], quality: 0.4, allowsEditing: false, exif: false });
  });
  it("the button exists only on the delivery leg", () => {
    expect(proofButtonVisible("pickup")).toBe(false);
    expect(proofButtonVisible("delivering")).toBe(true);
    expect(proofButtonVisible("delivered")).toBe(false);
  });
  it("native config: one camera-only image-picker entry, no media-library plugin, storage permissions blocked", () => {
    const plugins = (config.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(plugins.filter((p) => p === "expo-image-picker")).toHaveLength(1);
    expect(plugins).not.toContain("expo-media-library");
    expect(config.android?.blockedPermissions).toEqual(
      expect.arrayContaining(["android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"]),
    );
  });
});

describe("payout account", () => {
  const BOM = "﻿";
  it("an invalid IBAN never reaches the server", async () => {
    const save = vi.fn(async () => null);
    const out = await submitPayout("c1", "MD25AG000225100013104168", "Ion", save);
    expect(out.result).toBe("invalid");
    expect(save).not.toHaveBeenCalled();
  });
  it("what the client validated is what the server gets (BOM, NEL, spaces, lower case stripped)", async () => {
    const save = vi.fn(async () => null);
    const out = await submitPayout("c1", `${BOM}md24 ag00\u0085 0225 1000 1310 4168`, "  Ion Popescu ", save);
    expect(save).toHaveBeenCalledWith("c1", "MD24AG000225100013104168", "Ion Popescu");
    expect(out).toEqual({ result: "saved", saved: { iban: "MD24AG000225100013104168", holderName: "Ion Popescu" } });
  });
  it("a server refusal is reported as such", async () => {
    const out = await submitPayout("c1", "MD24AG000225100013104168", "Ion", async () => "Nu ai permisiunea pentru această acțiune.");
    expect(out).toEqual({ result: "failed", message: "Nu ai permisiunea pentru această acțiune." });
  });
  it("api.savePayoutAccount writes the courier's OWN account", async () => {
    await api.savePayoutAccount("c1", "MD24AG000225100013104168", "Ion");
    expect(h.calls).toEqual([
      {
        op: "rpc:set_payout_account",
        args: [{ p_recipient_type: "courier", p_recipient_id: "c1", p_iban: "MD24AG000225100013104168", p_holder_name: "Ion" }],
      },
    ]);
  });
  it("api.fetchMyPayoutAccount reads only courier rows of this courier", async () => {
    await api.fetchMyPayoutAccount("c1");
    const eqs = h.calls.filter((c) => c.op === "payout_accounts.eq").map((c) => c.args);
    expect(eqs).toEqual([["recipient_type", "courier"], ["recipient_id", "c1"]]);
  });
  it("the screen line never shows the full IBAN", () => {
    const s = payoutSummary({ iban: "MD24AG000225100013104168", holderName: "Ion" });
    expect(s).not.toContain("AG000225100013");
    expect(s).toContain("MD24 •••• 4168");
  });
});

describe("profile menu actions", () => {
  const deps = () => ({ togglePayout: vi.fn(), callSupport: vi.fn() as (() => void) | null, signOut: vi.fn() });
  it("each action calls exactly its own handler", () => {
    for (const [action, key] of [["payout", "togglePayout"], ["support", "callSupport"], ["signout", "signOut"]] as const) {
      const d = deps();
      runMenuAction(action, d);
      for (const k of ["togglePayout", "callSupport", "signOut"] as const) {
        expect((d[k] as ReturnType<typeof vi.fn>).mock.calls.length).toBe(k === key ? 1 : 0);
      }
    }
  });
  it("support without a configured number does nothing (and does not throw)", () => {
    expect(() => runMenuAction("support", { ...deps(), callSupport: null })).not.toThrow();
  });
  it("a 5-digit 'number' is not a support line", () => {
    expect(readSupportPhone("12345")).toBeNull();
    expect(readSupportPhone("123456")).not.toBeNull();
  });
});

describe("history lines", () => {
  it("tip first, then the fee note; each only when present", () => {
    expect(historyExtraLines({ tipLabel: "incl. bacșiș 15 MDL", feeNote: "tarif de bază" })).toEqual(["incl. bacșiș 15 MDL", "tarif de bază"]);
    expect(historyExtraLines({ tipLabel: null, feeNote: "tarif de bază" })).toEqual(["tarif de bază"]);
    expect(historyExtraLines({ tipLabel: "incl. bacșiș 15 MDL", feeNote: null })).toEqual(["incl. bacșiș 15 MDL"]);
  });
  it("a tip under 1 MDL is still a tip", () => {
    expect(historyTipLabel(0.5)).toBe("incl. bacșiș 0.5 MDL");
  });
});

// The screens only pass values through to the functions tested above; these pin the pass-through itself.
describe("screens pass the real values to the tested logic", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  it("ActiveDeliveryScreen", () => {
    const s = read("src/screens/ActiveDeliveryScreen.tsx");
    expect(s).toMatch(/const shown = describeReport\(kind, isNew\);\s*Alert\.alert\(shown\.title, shown\.text\);/);
    expect(s).toMatch(/\{proofButtonVisible\(status\) && \(/);
    expect(s).toMatch(/ImagePicker\.launchCameraAsync\(CAMERA_OPTIONS\)/);
  });
  it("PayoutAccountForm caps the input length", () => {
    expect(read("src/components/PayoutAccountForm.tsx")).toMatch(/maxLength=\{42\}/);
  });
});
