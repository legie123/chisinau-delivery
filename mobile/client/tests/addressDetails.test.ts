// Parity row 3: scară / etaj / interfon at checkout, using the EXISTING addresses columns the driver app
// already prints (mobile/driver orderView.ts). The floor is required once an apartment is set.
import { describe, expect, it } from "vitest";
import { addressDraftProblem, addressFingerprint, addressRow, apartmentDetailsProblem, type AddressDraft } from "../src/lib/checkout";

const base: AddressDraft = { street: "Str. Ion 1", phone: "+37369000000", notes: "", pin: { lat: 47.02, lng: 28.83 } };

describe("apartment details", () => {
  it("apartment without a floor is refused at save; a house passes; apartment + floor passes", () => {
    expect(addressDraftProblem({ ...base, apartment: "12" })).toMatch(/etajul/);
    expect(addressDraftProblem({ ...base })).toBeNull();
    expect(addressDraftProblem({ ...base, apartment: "12", floor: "3" })).toBeNull();
    expect(apartmentDetailsProblem({ apartment: "12", floor: " " })).toMatch(/etajul/);
  });

  it("the row carries entrance/floor/intercom_code (blank = NULL) and they are part of the retry fingerprint", () => {
    const d: AddressDraft = { ...base, apartment: "12", entrance: "2", floor: "3", intercom: "12K" };
    expect(addressRow(d)).toMatchObject({ apartment: "12", entrance: "2", floor: "3", intercom_code: "12K", lat: 47.02, lng: 28.83 });
    expect(addressRow(base)).toMatchObject({ entrance: null, floor: null, intercom_code: null });
    expect(addressFingerprint(d)).not.toBe(addressFingerprint({ ...d, floor: "4" }));
  });
});
