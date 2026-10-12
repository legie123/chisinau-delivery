// C1 on the phone: an address needs a pin (place_order refuses a pinless one, sim 102). The pin is
// what the map shows; an address whose street changed keeps its old pin only if the customer moved it.
import { describe, expect, it } from "vitest";
import { addressDraftProblem, addressEditPlan, addressSaveProblem, CHISINAU_CENTER } from "../src/lib/checkout";

const draft = { street: "Str. A 1", phone: "069111111", notes: "", pin: { lat: 47.01, lng: 28.86 }, sector: "", building: "", apartment: "", label: "" };
const before = { street_address: "Str. A 1", lat: 47.01, lng: 28.86, is_default: false };

describe("pin required", () => {
  it("a draft without a pin is refused with the map instruction", () => {
    expect(addressDraftProblem({ ...draft, pin: null })).toMatch(/pinul/);
    expect(addressDraftProblem(draft)).toBeNull();
  });

  it("street changed but the old pin untouched → the customer must move the pin", () => {
    expect(addressSaveProblem(before, { ...draft, street: "Str. B 2" })).toMatch(/mută pinul/);
    expect(addressSaveProblem(before, { ...draft, street: "Str. B 2", pin: { lat: 47.02, lng: 28.85 } })).toBeNull();
    expect(addressSaveProblem(before, draft)).toBeNull();
  });

  it("the saved row carries the pin from the map (insert and update)", () => {
    const moved = { ...draft, street: "Str. B 2", pin: { lat: 47.02, lng: 28.85 } };
    const ins = addressEditPlan(before, moved, true);
    expect(ins.kind === "insert" && ins.row).toMatchObject({ lat: 47.02, lng: 28.85 });
    const upd = addressEditPlan(before, moved, false);
    expect(upd.kind === "update" && upd.patch).toMatchObject({ lat: 47.02, lng: 28.85 });
  });

  it("the map opens on Chișinău when there is no pin yet", () => {
    expect(CHISINAU_CENTER.lat).toBeCloseTo(47.02, 1);
    expect(CHISINAU_CENTER.lng).toBeCloseTo(28.83, 1);
  });
});
