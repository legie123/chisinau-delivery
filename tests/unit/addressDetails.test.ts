import { describe, expect, it } from "vitest";
import { apartmentDetailsProblem, newAddressRow } from "@/lib/orders/addressDetails";

// Parity row 3: entrance / floor / intercom at checkout; the floor is required once an apartment is set.
describe("apartmentDetailsProblem", () => {
  it("apartment without a floor is refused; a house passes; apartment + floor passes", () => {
    expect(apartmentDetailsProblem({ apartment: "12", floor: "" })).toMatch(/etajul/);
    expect(apartmentDetailsProblem({ apartment: "12", floor: "  " })).toMatch(/etajul/);
    expect(apartmentDetailsProblem({ apartment: "", floor: "" })).toBeNull();
    expect(apartmentDetailsProblem({ apartment: "12", floor: "3" })).toBeNull();
  });
});

describe("newAddressRow", () => {
  it("writes entrance/floor/intercom_code to the EXISTING columns, blanks as NULL", () => {
    const row = newAddressRow({
      street_address: " Str. Ion 1 ", contact_phone: "+37369000000", sector: "", building: "7", apartment: "12",
      entrance: "2", floor: "3", intercom_code: "12K", notes: "",
    });
    expect(row).toEqual({
      street_address: "Str. Ion 1", contact_phone: "+37369000000", sector: null, building: "7", apartment: "12",
      entrance: "2", floor: "3", intercom_code: "12K", notes: null,
    });
  });
});
