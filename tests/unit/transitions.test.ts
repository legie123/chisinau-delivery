import { describe, it, expect } from "vitest";
import {
  ADVANCE_TRANSITIONS,
  canAdvance,
  nextAdvanceStatus,
  serializeAdvanceTransitions,
} from "@chisinau/shared-types";

// The TS half of the transitions↔RPC contract. tests/rpc/10_transitions_contract.sql
// asserts the REAL advance_delivery_status matrix equals THIS exact literal; here we
// assert the TS map serializes to it. Both green ⇒ TS map == RPC behavior.
const CONTRACT_LITERAL =
  '{"accepted":[],"cancelled":[],"courier_assigned":["picked_up"],"delivered":[],"en_route":["delivered"],"pending_restaurant":[],"picked_up":["en_route"],"ready_for_pickup":[],"rejected":[]}';

describe("delivery transitions ↔ advance_delivery_status contract", () => {
  it("serializes to the exact literal the SQL contract test probes", () => {
    // If this fails, the TS map and the RPC have diverged — fix BOTH sides + the
    // literal in tests/rpc/10_transitions_contract.sql together, never one alone.
    expect(serializeAdvanceTransitions()).toBe(CONTRACT_LITERAL);
  });

  it("canAdvance matches the courier delivery hops", () => {
    expect(canAdvance("courier_assigned", "picked_up")).toBe(true);
    expect(canAdvance("picked_up", "en_route")).toBe(true);
    expect(canAdvance("en_route", "delivered")).toBe(true);
    // no skipping / going backwards / moving a terminal order
    expect(canAdvance("courier_assigned", "delivered")).toBe(false);
    expect(canAdvance("en_route", "picked_up")).toBe(false);
    expect(canAdvance("delivered", "en_route")).toBe(false);
    // pre-dispatch statuses have no advance hop (they use their own RPCs)
    expect(canAdvance("accepted", "ready_for_pickup")).toBe(false);
  });

  it("nextAdvanceStatus gives the single next hop or null", () => {
    expect(nextAdvanceStatus("courier_assigned")).toBe("picked_up");
    expect(nextAdvanceStatus("picked_up")).toBe("en_route");
    expect(nextAdvanceStatus("en_route")).toBe("delivered");
    expect(nextAdvanceStatus("delivered")).toBeNull();
    expect(nextAdvanceStatus("pending_restaurant")).toBeNull();
  });

  it("every status is present in the map (exhaustive)", () => {
    expect(Object.keys(ADVANCE_TRANSITIONS)).toHaveLength(9);
  });
});
