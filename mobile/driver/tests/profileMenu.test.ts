import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSupportPhone } from "../src/lib/config";

const src = (f: string) => readFileSync(path.join(path.resolve(__dirname, ".."), f), "utf8");

describe("readSupportPhone (support row is hidden unless a real number is configured)", () => {
  it("unset, blank or malformed -> null (row hidden)", () => {
    expect(readSupportPhone(undefined)).toBeNull();
    expect(readSupportPhone("  ")).toBeNull();
    expect(readSupportPhone("sună-ne")).toBeNull();
    expect(readSupportPhone("+373")).toBeNull();
  });
  it("a configured number keeps its label and dials the digits", () => {
    expect(readSupportPhone("+373 22 123 456")).toEqual({ label: "+373 22 123 456", tel: "tel:+37322123456" });
  });
});

describe("Profile menu has no dead rows", () => {
  const s = src("src/screens/ProfileScreen.tsx");
  const menu = s.slice(s.indexOf("const MENU_ITEMS"), s.indexOf("];", s.indexOf("const MENU_ITEMS")));
  it("every row declares an action", () => {
    const rows = menu.split("\n").filter((l) => l.includes("label: '"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toMatch(/action: '(payout|support|signout)'/);
  });
  it("every action is handled, and the support row needs a configured number", () => {
    // what each action does is tested by behaviour in tests/behaviour.test.ts (runMenuAction)
    expect(s).toMatch(/runMenuAction\(item\.action, \{/);
    expect(s).toMatch(/readSupportPhone\(process\.env\.EXPO_PUBLIC_SUPPORT_PHONE\)/);
    expect(s).toMatch(/item\.action !== 'support' \|\| SUPPORT/);
  });
});
