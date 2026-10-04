import { describe, expect, it } from "vitest";
import { courierGpsMode } from "@/hooks/useBroadcastCourierLocation";

// Privacy + parity with the courier app (mobile/driver gpsGate): the customer's live broadcast
// only from pickup; before pickup the web courier feeds the restaurant's pickup map through the
// courier_locations upsert alone (RLS shows it to the restaurant, not the customer). The web used
// to send nothing before pickup, so the restaurant saw a stale position (verifier, 2026-10-04).
describe("courierGpsMode", () => {
  it("broadcasts to the customer only once the food is with the courier", () => {
    expect(courierGpsMode("picked_up")).toBe("broadcast");
    expect(courierGpsMode("en_route")).toBe("broadcast");
  });

  it("heading to pickup: courier_locations only, never the customer broadcast", () => {
    expect(courierGpsMode("courier_assigned")).toBe("upsert");
  });

  it("nothing before assignment or after the order ends", () => {
    for (const s of ["pending_restaurant", "accepted", "ready_for_pickup", "delivered", "cancelled", "rejected"]) {
      expect(courierGpsMode(s), s).toBeNull();
    }
  });
});
