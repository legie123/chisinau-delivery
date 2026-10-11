import { describe, expect, it } from "vitest";
import { parseMenuSheet } from "@/app/(admin)/restaurant/menu/import/parse";

describe("parseMenuSheet", () => {
  it("reads a tab-separated paste with a header and RO prices", () => {
    const r = parseMenuSheet("Categorie\tProdus\tDescriere\tPreț\nRoluri\tCalifornia\tcrab, avocado\t120,50\nSupe\tMiso\ttofu\t45 MDL\n");
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { category: "Roluri", name: "California", description: "crab, avocado", price: 120.5 },
      { category: "Supe", name: "Miso", description: "tofu", price: 45 },
    ]);
  });

  it("reads ; CSV without header, keeps empty category", () => {
    const r = parseMenuSheet(';Apă plată;0,5 l;"15.00"');
    expect(r.rows).toEqual([{ category: "", name: "Apă plată", description: "0,5 l", price: 15 }]);
  });

  it("reports bad rows by line and refuses duplicates", () => {
    const r = parseMenuSheet("A\tX\td\t0\nA\tY\t\t10\nA\tZ\nA\tW\td\t5\nA\tw\td\t6");
    expect(r.errors).toEqual([
      "Rândul 1 (X): preț invalid „0”.",
      "Rândul 2 (Y): descrierea este obligatorie.",
      "Rândul 3: sunt necesare 4 coloane (Categorie, Produs, Descriere, Preț).",
      "„w” apare de două ori în „A”.",
    ]);
    expect(r.rows.map((x) => x.name)).toEqual(["W", "w"]);
  });
});
