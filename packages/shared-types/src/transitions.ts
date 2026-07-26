import type { OrderStatus } from "./enums";

// The TypeScript projection of advance_delivery_status's transition matrix
// (supabase/migrations/20260725000100_money_integrity.sql — the courier-side
// delivery hops ONLY; accept/reject/ready/assign/cancel go through their own RPCs).
//
// CONTRACT: this map is bound to the real RPC by TWO tests —
//  - tests/rpc/10_transitions_contract.sql exhaustively drives every (from, to)
//    pair through the real RPC and asserts the verdict matches its embedded
//    matrix literal;
//  - tests/unit/transitions.test.ts asserts THIS map serializes to exactly that
//    embedded literal.
// Transitively: this map == real RPC behavior. Never edit one without the other —
// the suites fail loudly if you do. (This is the mechanism that prevents the
// doc/code drift that previously cost two stale known-issues.)
export const ADVANCE_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_restaurant: [],
  accepted: [],
  ready_for_pickup: [],
  courier_assigned: ["picked_up"],
  picked_up: ["en_route"],
  en_route: ["delivered"],
  delivered: [],
  cancelled: [],
  rejected: [],
} as const;

/** Can advance_delivery_status move an order from `from` to `to`? (Same-status is an idempotent no-op in the RPC, not a transition.) */
export function canAdvance(from: OrderStatus, to: OrderStatus): boolean {
  return (ADVANCE_TRANSITIONS[from] ?? []).includes(to);
}

/** The single next delivery hop for a status, or null (used by admin force-advance + courier controls). */
export function nextAdvanceStatus(from: OrderStatus): OrderStatus | null {
  return ADVANCE_TRANSITIONS[from][0] ?? null;
}

/** Canonical serialization used to bind this map to the SQL contract test. */
export function serializeAdvanceTransitions(): string {
  const keys = Object.keys(ADVANCE_TRANSITIONS).sort() as OrderStatus[];
  const obj: Record<string, readonly OrderStatus[]> = {};
  for (const k of keys) obj[k] = ADVANCE_TRANSITIONS[k];
  return JSON.stringify(obj);
}
