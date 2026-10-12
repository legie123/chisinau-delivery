import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { doorDetails } from "@/components/courier/doorDetails";

describe("doorDetails (web courier delivery card)", () => {
  it("shows entrance/floor/apartment/intercom with short Romanian labels, in door order", () => {
    expect(doorDetails({ building: "12", entrance: "2", floor: "3", apartment: "5", intercom_code: "45#" })).toBe(
      "Bloc 12, Scara 2, Etaj 3, Ap. 5, Interfon 45#",
    );
  });
  it("skips missing fields and is empty when nothing is known (never a placeholder)", () => {
    expect(doorDetails({ entrance: "B", apartment: "7", floor: null, intercom_code: "" })).toBe("Scara B, Ap. 7");
    expect(doorDetails({})).toBe("");
  });
  it("is what the courier delivery page renders (built AND called)", () => {
    const page = readFileSync("src/app/(courier)/deliveries/[deliveryId]/page.tsx", "utf8");
    expect(page).toMatch(/doorDetails\(typedAddress\)/);
  });
});
