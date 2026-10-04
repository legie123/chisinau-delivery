import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, ORDER_STATUS_LABEL, TERMINAL_STATUSES } from "@chisinau/shared-types";
import {
  PROGRESS_STEPS,
  customerCanCancel,
  customerCanTip,
  isTerminal,
  progressIndex,
  showsCourierOnMap,
  statusLabel,
  statusTone,
} from "../src/lib/orderStatus";

describe("order status — the phone says what the web says", () => {
  it.each(ORDER_STATUSES)("label for %s comes from shared-types", (s) => {
    expect(statusLabel(s)).toBe(ORDER_STATUS_LABEL[s]);
  });

  it("an unknown (newer) status is never shown raw", () => {
    expect(statusLabel("refund_review")).toBe("Se actualizează");
  });

  it("terminal set is exactly shared-types TERMINAL_STATUSES", () => {
    expect(ORDER_STATUSES.filter(isTerminal)).toEqual([...TERMINAL_STATUSES]);
  });

  it("cancel only before the restaurant accepts (cancel_order rule)", () => {
    expect(ORDER_STATUSES.filter(customerCanCancel)).toEqual(["pending_restaurant"]);
  });

  it("tip editable on live orders only (set_order_tip refuses terminal)", () => {
    for (const s of ORDER_STATUSES) expect(customerCanTip(s)).toBe(!TERMINAL_STATUSES.includes(s));
    expect(customerCanTip("weird")).toBe(false);
  });

  it("live courier pin from assignment until delivery", () => {
    expect(ORDER_STATUSES.filter(showsCourierOnMap)).toEqual(["courier_assigned", "picked_up", "en_route"]);
  });

  it("progress rail follows the lifecycle; cancelled/rejected are off-rail", () => {
    expect(PROGRESS_STEPS.map(progressIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(progressIndex("cancelled")).toBe(-1);
    expect(progressIndex("rejected")).toBe(-1);
    expect(statusTone("delivered")).toBe("done");
    expect(statusTone("rejected")).toBe("failed");
    expect(statusTone("en_route")).toBe("active");
  });
});
