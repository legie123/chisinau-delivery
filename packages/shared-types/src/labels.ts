import type { OrderStatus } from "./enums";

// Romanian customer-facing labels for the order lifecycle — shared so web and
// Expo can never show different words for the same status.
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_restaurant: "În așteptare",
  accepted: "Acceptată",
  ready_for_pickup: "Gata de ridicare",
  courier_assigned: "Curier atribuit",
  picked_up: "Ridicată",
  en_route: "Pe drum",
  delivered: "Livrată",
  cancelled: "Anulată",
  rejected: "Refuzată",
};
