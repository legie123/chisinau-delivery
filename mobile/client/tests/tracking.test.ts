import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QUOTE_LABEL,
  courierActive,
  firstName,
  formatEventDate,
  guestsLabel,
  haversineM,
  paymentPresence,
  prepCountdown,
  showsPrepCountdown,
  supportMailto,
  telUrl,
  trackingRoute,
} from "../src/lib/tracking";

const pickup = { lat: 47.0105, lng: 28.8638 };
const dropoff = { lat: 47.0245, lng: 28.8322 };
const courier = { lat: 47.02, lng: 28.84 };

describe("route + ETA (web straight-line fallback)", () => {
  it("haversine: 0.01° latitude ≈ 1.11 km", () => {
    expect(haversineM({ lat: 47, lng: 28 }, { lat: 47.01, lng: 28 })).toBeGreaterThan(1100);
    expect(haversineM({ lat: 47, lng: 28 }, { lat: 47.01, lng: 28 })).toBeLessThan(1125);
  });

  it("carrying + live fix → courier→dropoff, 'Sosire ~N min' at 22 km/h", () => {
    const r = trackingRoute({ status: "en_route", pickup, dropoff, courier })!;
    expect(r.line).toEqual([courier, dropoff]);
    const expected = Math.max(1, Math.round(haversineM(courier, dropoff) / (22_000 / 60)));
    expect(r.minutes).toBe(expected);
    expect(r.label).toBe(`Sosire ~${expected} min`);
  });

  it("before pickup the courier's position is NOT the route start (he is heading to the restaurant)", () => {
    const r = trackingRoute({ status: "courier_assigned", pickup, dropoff, courier })!;
    expect(r.line[0]).toEqual(pickup);
    expect(r.label).toMatch(/^~\d+ min de livrare$/);
  });

  it("carrying without a fix yet → pickup preview", () => {
    expect(trackingRoute({ status: "picked_up", pickup, dropoff, courier: null })!.line[0]).toEqual(pickup);
  });

  it("never under 1 min; nothing for finished orders or without a dropoff", () => {
    expect(trackingRoute({ status: "en_route", pickup, dropoff, courier: dropoff })!.label).toBe("Sosire ~1 min");
    for (const status of ["delivered", "cancelled", "rejected"]) {
      expect(trackingRoute({ status, pickup, dropoff, courier })).toBeNull();
    }
    expect(trackingRoute({ status: "accepted", pickup, dropoff: null, courier: null })).toBeNull();
    expect(trackingRoute({ status: "accepted", pickup: null, dropoff, courier: null })).toBeNull();
  });
});

describe("prep countdown (PrepCountdown.tsx parity)", () => {
  afterEach(() => vi.useRealTimers());
  const now = new Date("2026-10-08T12:00:00Z"); // 15:00 Chișinău
  const inMin = (m: number) => new Date(now.getTime() + m * 60_000).toISOString();

  it("shown only while the kitchen works and a target exists", () => {
    expect(showsPrepCountdown("accepted", inMin(10))).toBe(true);
    expect(showsPrepCountdown("courier_assigned", inMin(10))).toBe(true);
    expect(showsPrepCountdown("pending_restaurant", inMin(10))).toBe(false);
    expect(showsPrepCountdown("picked_up", inMin(10))).toBe(false);
    expect(showsPrepCountdown("accepted", null)).toBe(false);
  });

  it("minutes, then the past-due wording per status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(prepCountdown(inMin(12), "accepted")).toEqual({ headline: "Gata în ~12 min", arrive: "Sosește ~15:27" });
    expect(prepCountdown(inMin(-3), "accepted").headline).toBe("Din clipă în clipă");
    expect(prepCountdown(inMin(-3), "ready_for_pickup").headline).toBe("Gata — se pregătește ridicarea");
  });

  it("past the 90-min horizon it states the clock, not '~758 min'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(prepCountdown(inMin(120), "accepted").headline).toBe("Gata ~17:00");
  });
});

describe("courier card", () => {
  it("only from assignment until delivery, and only with a courier", () => {
    expect(courierActive("courier_assigned", "c1")).toBe(true);
    expect(courierActive("en_route", "c1")).toBe(true);
    expect(courierActive("ready_for_pickup", "c1")).toBe(false);
    expect(courierActive("delivered", "c1")).toBe(false);
    expect(courierActive("en_route", null)).toBe(false);
  });

  it("first name and a dialable tel: URL", () => {
    expect(firstName("  Ion  Popescu ")).toBe("Ion");
    expect(firstName("")).toBeNull();
    expect(firstName(null)).toBeNull();
    expect(telUrl("+373 69 123 456")).toBe("tel:+37369123456");
    expect(telUrl("069-123-456")).toBe("tel:069123456");
    expect(telUrl("")).toBeNull();
    expect(telUrl(null)).toBeNull();
  });
});

describe("payment line (payment.ts parity)", () => {
  const p = (method: string, status: string, orderStatus = "en_route") =>
    paymentPresence({ method, status, orderStatus, amountMdl: 250 });

  it("paying at the door: unpaid is normal, no banner", () => {
    expect(p("cash", "unpaid")).toEqual({ totalLabel: "cash", notice: null });
    expect(p("card_on_delivery", "unpaid")).toEqual({ totalLabel: "card la livrare", notice: null });
  });

  it("online states say what happened to the money", () => {
    expect(p("online_gateway", "paid")).toEqual({ totalLabel: "plătit online", notice: null });
    expect(p("online_gateway", "failed").notice?.label).toBe("Plata online nu a trecut");
    expect(p("online_gateway", "pending_capture").notice?.detail).toBe("250 MDL blocați, încă neîncasați");
    expect(p("online_gateway", "unpaid").notice?.tone).toBe("warning");
    expect(p("online_gateway", "unpaid", "cancelled").notice).toEqual({ label: "Nu ai fost taxat", detail: "plata online nu a pornit", tone: "good" });
  });

  it("a refund is shown on ANY method", () => {
    expect(p("cash", "refunded")).toEqual({
      totalLabel: "cash, bani returnați",
      notice: { label: "Banii ți-au fost returnați", detail: "250 MDL", tone: "good" },
    });
    expect(p("online_gateway", "refund_pending").totalLabel).toBe("online, returnare în curs");
  });
});

describe("catering + support", () => {
  it("every quote_status has Romanian wording; declined is the restaurant's", () => {
    expect(Object.keys(QUOTE_LABEL).sort()).toEqual(["confirmed", "declined", "quoted", "requested"]);
    expect(QUOTE_LABEL.declined).toBe("Restaurantul a refuzat cererea");
  });

  it("event date without timezone drift; guest count", () => {
    expect(formatEventDate("2026-10-12")).toBe("12.10.2026");
    expect(formatEventDate("garbage")).toBe("garbage");
    expect(guestsLabel(1)).toBe("1 invitat");
    expect(guestsLabel(40)).toBe("40 invitați");
  });

  it("support mail carries the order number", () => {
    expect(supportMailto("CHD-2026-000011")).toBe("mailto:contact@dragonsdelivery.md?subject=Comanda%20CHD-2026-000011");
  });
});
