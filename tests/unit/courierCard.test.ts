import { describe, expect, it } from "vitest";
import { showsCourierCard } from "@/lib/kitchen/courierCard";

describe("showsCourierCard", () => {
  it("shows for every assigned status once a courier exists", () => {
    for (const s of ["courier_assigned", "picked_up", "en_route"]) {
      expect(showsCourierCard(s, "c-1")).toBe(true);
    }
  });
  it("hides before assignment, after delivery, or without a courier id", () => {
    expect(showsCourierCard("accepted", "c-1")).toBe(false);
    expect(showsCourierCard("ready_for_pickup", "c-1")).toBe(false);
    expect(showsCourierCard("delivered", "c-1")).toBe(false);
    expect(showsCourierCard("courier_assigned", null)).toBe(false);
    expect(showsCourierCard("courier_assigned", "")).toBe(false);
  });
});
