import { describe, expect, it } from "vitest";
import { bulkPrices } from "@/app/(admin)/restaurant/menu/prices/bulk";

const items = [
  { id: "a", name: "Roll", price_mdl: 120 },
  { id: "b", name: "Supă", price_mdl: 45 },
];

describe("bulkPrices", () => {
  it("percent: rounds to whole MDL", () => {
    expect(bulkPrices(items, "percent", 10).changes).toEqual([
      { id: "a", name: "Roll", from: 120, to: 132 },
      { id: "b", name: "Supă", from: 45, to: 50 }, // 49.5 → 50
    ]);
  });
  it("amount: adds a fixed MDL value", () => {
    expect(bulkPrices(items, "amount", -5).changes.map((c) => c.to)).toEqual([115, 40]);
  });
  it("refuses zero, more than ±50 %, and a price that would hit 0", () => {
    expect(bulkPrices(items, "percent", 0).error).toMatch(/diferită de 0/);
    expect(bulkPrices(items, "percent", 60).error).toMatch(/50 %/);
    expect(bulkPrices(items, "amount", -45).error).toMatch(/peste 0/);
    expect(bulkPrices(items, "amount", 30).error).toMatch(/Supă.*peste 50 %/);
  });
});
