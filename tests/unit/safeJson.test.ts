import { describe, expect, it } from "vitest";
import { jsonForScript } from "@/lib/seo/safeJson";

// A partner can name a menu item anything. Inside <script type="application/ld+json">, plain
// JSON.stringify leaves "</script>" intact, so the HTML parser closes the element and runs what
// follows. jsonForScript must never emit "<" or ">" and must still parse to the same value.
describe("jsonForScript", () => {
  const LS = String.fromCharCode(0x2028);
  const payload = { name: "Sushi</script><script>alert(document.cookie)</script>", note: "a & b " + LS + " c" };

  it("cannot close the surrounding <script> element", () => {
    const out = jsonForScript(payload);
    expect(out).not.toMatch(/<\/?script/i);
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain(LS);
  });

  it("parses back to exactly the same value", () => {
    expect(JSON.parse(jsonForScript(payload))).toEqual(payload);
  });

  it("is what plain JSON.stringify gets wrong (the bug it replaces)", () => {
    expect(JSON.stringify(payload)).toMatch(/<\/script>/);
  });
});
