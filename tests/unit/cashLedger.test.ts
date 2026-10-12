import { describe, expect, it } from "vitest";
import { summarizeLedger } from "@/lib/admin/cashLedger";

const row = (courier_id: string, kind: string, amount_mdl: number, created_at: string) => ({ courier_id, kind, amount_mdl, created_at });

describe("summarizeLedger", () => {
  it("balance = collected minus offloads and reversals, per courier, highest debt first", () => {
    const out = summarizeLedger([
      row("a", "collected", 500, "2026-10-10T10:00:00Z"),
      row("a", "offload", -300, "2026-10-10T12:00:00Z"),
      row("b", "collected", 900, "2026-10-11T09:00:00Z"),
      row("b", "refund_reversal", -100, "2026-10-11T10:00:00Z"),
    ]);
    expect(out).toEqual([
      { courierId: "b", balance: 800, collected: 900, offloaded: 0, other: -100, lastAt: "2026-10-11T10:00:00Z", movements: 2 },
      { courierId: "a", balance: 200, collected: 500, offloaded: -300, other: 0, lastAt: "2026-10-10T12:00:00Z", movements: 2 },
    ]);
  });
  it("numeric strings from PostgREST are summed as numbers, not concatenated", () => {
    const out = summarizeLedger([
      { courier_id: "a", kind: "collected", amount_mdl: "120.50", created_at: "2026-10-10T10:00:00Z" },
      { courier_id: "a", kind: "collected", amount_mdl: "79.50", created_at: "2026-10-10T11:00:00Z" },
    ]);
    expect(out[0].balance).toBe(200);
  });
  it("empty ledger -> empty summary", () => {
    expect(summarizeLedger([])).toEqual([]);
  });
});
