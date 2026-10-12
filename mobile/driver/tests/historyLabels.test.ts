import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { historyFeeNote, historyTipLabel } from "../src/lib/earnings";

const src = (f: string) => readFileSync(path.join(path.resolve(__dirname, ".."), f), "utf8");

describe("historyTipLabel — the tip inside the net, shown per delivery", () => {
  it("shows a positive tip, accepting PostgREST numeric strings", () => {
    expect(historyTipLabel(15)).toBe("incl. bacșiș 15 MDL");
    expect(historyTipLabel("7.50")).toBe("incl. bacșiș 7.5 MDL");
  });
  it("no tip, zero, or garbage -> nothing shown", () => {
    expect(historyTipLabel(null)).toBeNull();
    expect(historyTipLabel(0)).toBeNull();
    expect(historyTipLabel("x")).toBeNull();
  });
});

describe("historyFeeNote — say when the fee used an assumed distance", () => {
  it("only true says so; false (measured) and null (not evaluated) say nothing", () => {
    expect(historyFeeNote(true)).toMatch(/tarif de bază.*revizuire/);
    expect(historyFeeNote(false)).toBeNull();
    expect(historyFeeNote(null)).toBeNull();
  });
});

describe("wiring", () => {
  it("history reads tip_mdl and courier_fee_distance_assumed and maps both", () => {
    const s = src("src/lib/api.ts");
    expect(s).toMatch(/tip_mdl, payment_status, courier_fee_distance_assumed, restaurants\(name\)/);
    expect(s).toMatch(/tipLabel: historyTipLabel\(o\.tip_mdl\)/);
    expect(s).toMatch(/feeNote: historyFeeNote\(o\.courier_fee_distance_assumed\)/);
  });
  it("the history screen renders both lines", () => {
    const s = src("src/screens/OrdersHistoryScreen.tsx");
    expect(s).toMatch(/order\.tipLabel &&/);
    expect(s).toMatch(/order\.feeNote &&/);
  });
});
