import { describe, expect, it } from "vitest";
import { auditDiff } from "@/lib/admin/auditDiff";

describe("auditDiff", () => {
  it("lists every changed key with its old and new value", () => {
    expect(auditDiff("UPDATE", { status: "accepted", tip_mdl: 0 }, { status: "cancelled", tip_mdl: 10 })).toEqual([
      { key: "status", from: "accepted", to: "cancelled" },
      { key: "tip_mdl", from: "0", to: "10" },
    ]);
  });
  it("shows an INSERT as new values only and a DELETE as old values only", () => {
    expect(auditDiff("INSERT", null, { full_name: "***" })).toEqual([{ key: "full_name", from: null, to: "***" }]);
    expect(auditDiff("DELETE", { id: "x" }, null)).toEqual([{ key: "id", from: "x", to: null }]);
  });
  it("renders null and objects readably, keeps masked values masked", () => {
    expect(auditDiff("UPDATE", { notes: "***", meta: null }, { notes: null, meta: { a: 1 } })).toEqual([
      { key: "meta", from: "—", to: '{"a":1}' },
      { key: "notes", from: "***", to: "—" },
    ]);
  });
});
