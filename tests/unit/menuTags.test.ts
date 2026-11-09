import { describe, expect, it } from "vitest";
import { parseTags } from "@/lib/kitchen/menuTags";

describe("parseTags", () => {
  it("splits on comma, trims, lowercases, drops empties", () => {
    expect(parseTags(" Vegan , PICANT,, fără gluten ,")).toEqual(["vegan", "picant", "fără gluten"]);
  });

  it("dedupes case-insensitively", () => {
    expect(parseTags("vegan, Vegan, VEGAN, picant")).toEqual(["vegan", "picant"]);
  });

  it("keeps at most 10 tags, each at most 24 chars", () => {
    const many = Array.from({ length: 12 }, (_, i) => `t${i}`).join(",");
    expect(parseTags(many)).toHaveLength(10);
    expect(parseTags("a".repeat(30))).toEqual(["a".repeat(24)]);
  });

  it("handles empty / null input", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags(null)).toEqual([]);
  });
});
