import { describe, expect, it } from "vitest";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  type OrderStatus,
  type PaymentMethod,
} from "@/lib/types/domain";

// The schema enums are the source of truth (migrations 000400) — a status
// added there without a label would render raw English in the UI.
const DB_ORDER_STATUSES: OrderStatus[] = [
  "pending_restaurant",
  "accepted",
  "ready_for_pickup",
  "courier_assigned",
  "picked_up",
  "en_route",
  "delivered",
  "cancelled",
  "rejected",
];

const DB_PAYMENT_METHODS: PaymentMethod[] = ["cash", "card_on_delivery", "online_gateway"];

describe("domain label maps stay in sync with the DB enums", () => {
  it("every order status has a non-empty Romanian label", () => {
    for (const status of DB_ORDER_STATUSES) {
      expect(ORDER_STATUS_LABEL[status], status).toBeTruthy();
    }
    expect(Object.keys(ORDER_STATUS_LABEL)).toHaveLength(DB_ORDER_STATUSES.length);
  });

  it("every payment method has a non-empty label", () => {
    for (const method of DB_PAYMENT_METHODS) {
      expect(PAYMENT_METHOD_LABEL[method], method).toBeTruthy();
    }
    expect(Object.keys(PAYMENT_METHOD_LABEL)).toHaveLength(DB_PAYMENT_METHODS.length);
  });
});
