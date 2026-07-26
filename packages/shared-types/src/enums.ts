// Canonical status/enum unions — the single source of truth for every surface
// (web route groups + Expo apps). The DB models these as text + CHECK constraints
// (not PG enums), so the generated types can't carry them — this file is the
// hand-maintained projection, and the transitions↔RPC contract test in
// tests/rpc/10_transitions_contract.sql + tests/unit/transitions.test.ts keeps it
// honest against the real advance_delivery_status behavior.

export type OrderStatus =
  | "pending_restaurant"
  | "accepted"
  | "ready_for_pickup"
  | "courier_assigned"
  | "picked_up"
  | "en_route"
  | "delivered"
  | "cancelled"
  | "rejected";

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "pending_restaurant",
  "accepted",
  "ready_for_pickup",
  "courier_assigned",
  "picked_up",
  "en_route",
  "delivered",
  "cancelled",
  "rejected",
] as const;

export type PaymentMethod = "cash" | "card_on_delivery" | "online_gateway";

export type PaymentStatus =
  | "unpaid"
  | "pending_capture"
  | "paid"
  | "refund_pending"
  | "refunded"
  | "failed";

export type OrderType = "standard" | "catering";

export type QuoteStatus = "requested" | "quoted" | "confirmed" | "declined";

export type Role = "customer" | "courier" | "restaurant_partner" | "platform_admin";

/** Statuses after which an order can no longer move. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ["delivered", "cancelled", "rejected"] as const;
