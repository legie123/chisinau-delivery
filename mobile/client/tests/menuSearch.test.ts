// Parity row 11: search inside a restaurant's menu. Diacritics/case-insensitive over name, description
// and category; a query searches the WHOLE menu (the category pill is ignored), no query = old behaviour.
import { describe, expect, it } from "vitest";
import { filterMenu, foldText } from "../src/lib/browse";

const menu = [
  { name: "Philadelphia", description: "somon, cremă de brânză", category: "Rulouri" },
  { name: "Ramen cu pește", description: "supă, ou", category: "Supe" },
  { name: "Ștrudel", description: "mere, scorțișoară", category: "Deserturi" },
];

describe("filterMenu", () => {
  it("no query: the selected category filters, null = everything", () => {
    expect(filterMenu(menu, "Supe", "").map((i) => i.name)).toEqual(["Ramen cu pește"]);
    expect(filterMenu(menu, null, "  ")).toHaveLength(3);
  });
  it("a query searches the whole menu and ignores the category", () => {
    expect(filterMenu(menu, "Supe", "philadel").map((i) => i.name)).toEqual(["Philadelphia"]);
  });
  it("diacritics and case do not matter, description and category count", () => {
    expect(filterMenu(menu, null, "PESTE").map((i) => i.name)).toEqual(["Ramen cu pește"]);
    expect(filterMenu(menu, null, "strudel").map((i) => i.name)).toEqual(["Ștrudel"]);
    expect(filterMenu(menu, null, "scortisoara")).toHaveLength(1);
    expect(filterMenu(menu, null, "deserturi")).toHaveLength(1);
    expect(filterMenu(menu, null, "zzz")).toHaveLength(0);
  });
  it("foldText folds both ş/ș and ţ/ț forms", () => {
    expect(foldText("Şt Ţ ș ț")).toBe("st t s t");
  });
});
