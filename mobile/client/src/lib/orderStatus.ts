import { ORDER_STATUS_LABEL, TERMINAL_STATUSES, type OrderStatus } from "@chisinau/shared-types";

// Customer-side reading of the order lifecycle. Labels come from shared-types so the
// phone and the web can never show different words for the same status.

const KNOWN = new Set(Object.keys(ORDER_STATUS_LABEL));

export function isOrderStatus(s: string): s is OrderStatus {
  return KNOWN.has(s);
}

/** Romanian label; an unknown (newer-than-the-app) status is never shown raw. */
export function statusLabel(status: string): string {
  return isOrderStatus(status) ? ORDER_STATUS_LABEL[status] : "Se actualizează";
}

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** cancel_order lets the customer cancel only before the restaurant accepted. */
export function customerCanCancel(status: string): boolean {
  return status === "pending_restaurant";
}

/** customer_report_problem (sim 112): any state after the restaurant accepted — before that, cancel. */
export function customerCanReport(status: string): boolean {
  return isOrderStatus(status) && status !== "pending_restaurant";
}

/** The kinds order_complaints accepts, as the app shows them. */
export const PROBLEM_KINDS = [
  { key: "missing_item", label: "Lipsește un produs" },
  { key: "wrong_item", label: "Produs greșit" },
  { key: "late", label: "Întârziere" },
  { key: "quality", label: "Calitate" },
  { key: "courier", label: "Curierul" },
  { key: "other", label: "Altceva" },
] as const;

/** set_order_tip refuses delivered / cancelled / rejected. */
export function customerCanTip(status: string): boolean {
  return isOrderStatus(status) && !isTerminal(status);
}

/** The courier is on the road with the food (or heading to it) — show the live pin. */
export function showsCourierOnMap(status: string): boolean {
  return status === "courier_assigned" || status === "picked_up" || status === "en_route";
}

export type StatusTone = "done" | "failed" | "active";

export function statusTone(status: string): StatusTone {
  if (status === "delivered") return "done";
  if (status === "cancelled" || status === "rejected") return "failed";
  return "active";
}

/** The happy-path steps shown as a progress rail. */
export const PROGRESS_STEPS: readonly OrderStatus[] = [
  "pending_restaurant",
  "accepted",
  "ready_for_pickup",
  "courier_assigned",
  "picked_up",
  "en_route",
  "delivered",
];

/** Index of the current step on the rail, or -1 for cancelled/rejected/unknown. */
export function progressIndex(status: string): number {
  return PROGRESS_STEPS.indexOf(status as OrderStatus);
}
