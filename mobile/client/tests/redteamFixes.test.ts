// Red-team findings on the customer app. Every block names the finding it pins.
// The phone runs in New York here: anything that leaks device-local time shows up.
process.env.TZ = "America/New_York";

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addressEditPlan,
  addressSaveProblem,
  CASH_CAP_HINT,
  CASH_CAP_MDL,
  chisinauDays,
  chisinauWallTime,
  scheduleProblem,
  TIP_MAX_MDL,
  tipLimit,
  tipProblem,
} from "../src/lib/checkout";
import { errorText } from "../src/lib/errors";
import { planReorder, type ReorderGroup } from "../src/lib/reorder";

describe("HIGH 1 — editing an address an order references never mutates it", () => {
  const before = { street_address: "Str. A 1", lat: 47.01, lng: 28.86, is_default: true };
  const draft = { street: "Str. A 1", phone: "069111111", notes: "etaj 3", pin: { lat: 47.01, lng: 28.86 }, sector: "", building: "", apartment: "7", floor: "2", label: "Acasă" };

  it("used by any order → a NEW row (same pin while the street is unchanged), default carried over", () => {
    const plan = addressEditPlan(before, draft, true);
    expect(plan).toEqual({
      kind: "insert",
      makeDefault: true,
      row: { street_address: "Str. A 1", contact_phone: "069111111", notes: "etaj 3", label: "Acasă", sector: null, building: null, apartment: "7", entrance: null, floor: "2", intercom_code: null, lat: 47.01, lng: 28.86 },
    });
  });

  it("used + street moved (pin moved on the map) → new row with the new pin; a non-default stays non-default", () => {
    const plan = addressEditPlan({ ...before, is_default: false }, { ...draft, street: "Str. B 2", pin: { lat: 47.02, lng: 28.85 } }, true);
    expect(plan.kind).toBe("insert");
    if (plan.kind !== "insert") return;
    expect(plan.row).toMatchObject({ lat: 47.02, lng: 28.85 });
    expect(plan.makeDefault).toBe(false);
  });

  it("never used → updated in place with the pin shown on the map; a moved street needs a moved pin", () => {
    const same = addressEditPlan(before, draft, false);
    expect(same.kind).toBe("update");
    if (same.kind === "update") expect(same.patch).toMatchObject({ lat: 47.01, lng: 28.86 });
    // the stale-pin case is refused before the plan runs (addressSaveProblem, tests/pinRequired)
    expect(addressSaveProblem(before, { ...draft, street: "Str. B 2" })).toMatch(/mută pinul/);
  });
});

describe("HIGH 2 — custom tip bounded by the subtotal and 500 MDL", () => {
  it("limit = min(subtotal, 500)", () => {
    expect(TIP_MAX_MDL).toBe(500);
    expect(tipLimit(300)).toBe(300);
    expect(tipLimit(2000)).toBe(500);
    expect(tipLimit(0)).toBe(0);
  });

  it("over the limit → Romanian message; at the limit → fine", () => {
    expect(tipProblem(2000, 500)).toBeNull();
    expect(tipProblem(2000, 501)).toMatch(/cel mult 500 MDL/);
    expect(tipProblem(300, 301)).toMatch(/cel mult 300 MDL/);
    expect(tipProblem(300, 99999)).toMatch(/Bacșișul/);
    expect(tipProblem(300, 0)).toBeNull();
  });
});

describe("MED 3 — the date picker is Chișinău's calendar, not the phone's", () => {
  it("runs under a non-Chișinău zone (else this block proves nothing)", () => {
    expect(new Date(2026, 9, 8).getTimezoneOffset()).toBe(240);
  });

  it("'Azi' is the Chișinău date: 18:30 in New York is already tomorrow (01:30) in Chișinău", () => {
    const now = Date.parse("2026-10-08T22:30:00Z");
    expect(new Date(now).getDate()).toBe(8); // the phone's own idea of today
    const days = chisinauDays(3, now);
    expect(days.map((d) => d.value)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(days[0].label).toBe("Azi");
    expect(days[1].label).toBe("Mâine");
  });

  it("no day skipped or repeated across the Chișinău DST change (25 Oct 2026)", () => {
    const days = chisinauDays(4, Date.parse("2026-10-23T21:30:00Z"));
    expect(days.map((d) => d.value)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  });

  it("scheduleProblem's 'now' is an instant: Chișinău wall times compare right from any zone", () => {
    const now = Date.parse("2026-10-08T22:30:00Z"); // 01:30 on the 9th in Chișinău
    expect(scheduleProblem(chisinauWallTime("2026-10-09", "01:00"), null, now)).toMatch(/în viitor/);
    expect(scheduleProblem(chisinauWallTime("2026-10-09", "02:00"), null, now)).toBeNull();
  });
});

describe("MED 4 — the cash cap is a hint, kept in one place, and the server's refusal reads the same", () => {
  it("place_order's refusal maps to the hint built from the one constant", () => {
    expect(CASH_CAP_HINT).toContain(`${CASH_CAP_MDL} MDL`);
    expect(errorText(new Error(`Comenzile cash peste ${CASH_CAP_MDL} MDL nu sunt acceptate`), "x")).toBe(CASH_CAP_HINT);
  });

  it("no other app file hardcodes 1400, and the order button does not gate on it", () => {
    const src = path.resolve(__dirname, "../src");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? files(path.join(dir, f)) : [path.join(dir, f)]));
    const offenders = files(src).filter((f) => !f.endsWith("checkout.ts") && /\b1400\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    const cart = readFileSync(path.join(src, "screens/CartScreen.tsx"), "utf8");
    expect(cart.match(/const blocked = .*/)?.[0]).not.toMatch(/overCashCap/);
  });
});

describe("MED 5 — reorder label only names the options actually kept", () => {
  const groups: ReorderGroup[] = [
    { menu_item_id: "m2", name: "Extra", is_required: false, min_select: 0, menu_options: [{ id: "o-ginger", name: "Ghimbir" }] },
  ];
  it("a removed option is dropped from ids AND from the label", () => {
    const { cart } = planReorder(
      { id: "r1", name: "Sakura" },
      [{ menu_item_id: "m2", item_name_snapshot: "Miso", unit_price_mdl: 60, quantity: 1, selected_options: [{ group: "Extra", name: "Ghimbir" }, { group: "Extra", name: "Wasabi" }] }],
      groups,
      [{ id: "m2", is_available: true }],
    );
    expect(cart.lines[0].optionIds).toEqual(["o-ginger"]);
    expect(cart.lines[0].optionsLabel).toBe("Ghimbir");
  });
});
