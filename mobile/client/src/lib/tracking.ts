import { COUNTDOWN_HORIZON_MIN, DELIVERY_BUFFER_MIN, formatTargetClock, minutesUntil } from "@chisinau/shared-domain";
import type { LatLng } from "./realtime";

// Pure presentation logic for the tracking screen (no React Native imports, so the
// tests run under node). Native twins of web pieces that live in src/ — which this
// app may not import — and are NOT in packages/shared-*:
//   - route + ETA      ← src/lib/routing/route.ts (straightLineFallback, haversineM)
//   - payment line     ← src/lib/orders/payment.ts (paymentPresence)
//   - prep countdown   ← src/components/customer/PrepCountdown.tsx
//   - catering wording ← src/components/customer/CateringTracking.tsx (QUOTE_LABEL)
// ponytail: copies, not imports — move them into packages/shared-domain when someone
// may edit packages/, then both apps import one source.

// ── Route + ETA ─────────────────────────────────────────────────────────────────

export function haversineM(from: LatLng, to: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Web's road-router fallback speed: an urban scooter weaving through Chișinău. */
export const FALLBACK_KMH = 22;

export type TrackingRoute = { line: LatLng[]; minutes: number; label: string };

/**
 * The line drawn on the map + the ETA chip. Same choice as the web tracker
 * (OrderTracking + useRoute): courier → dropoff once the courier carries the food
 * and has a fix ("Sosire ~N min"), otherwise a pickup → dropoff preview
 * ("~N min de livrare"). The web gets a road route from its server-only /api/route
 * (OSRM); the app has no such endpoint, so this is the web's own straight-line
 * fallback. Nothing for finished orders.
 */
export function trackingRoute(input: {
  status: string;
  pickup: LatLng | null;
  dropoff: LatLng | null;
  courier: LatLng | null;
}): TrackingRoute | null {
  const { status, pickup, dropoff, courier } = input;
  if (!dropoff || status === "delivered" || status === "cancelled" || status === "rejected") return null;
  const carrying = status === "picked_up" || status === "en_route";
  const from = carrying && courier ? courier : pickup;
  if (!from) return null;
  const minutes = Math.max(1, Math.round(haversineM(from, dropoff) / ((FALLBACK_KMH * 1000) / 60)));
  return {
    line: [from, dropoff],
    minutes,
    label: carrying && courier ? `Sosire ~${minutes} min` : `~${minutes} min de livrare`,
  };
}

// ── Prep countdown (PrepCountdown.tsx) ──────────────────────────────────────────

const PREP_STATUSES = ["accepted", "ready_for_pickup", "courier_assigned"];

export function showsPrepCountdown(status: string, estimatedReadyAt: string | null): estimatedReadyAt is string {
  return estimatedReadyAt != null && PREP_STATUSES.includes(status);
}

/** Headline + arrival clock; reads Date.now() via shared-domain, so re-call on a tick. */
export function prepCountdown(estimatedReadyAt: string, status: string): { headline: string; arrive: string } {
  const readyIn = minutesUntil(estimatedReadyAt);
  const headline =
    // A scheduled order's target can be hours away — say the time, not "~758 min".
    readyIn > COUNTDOWN_HORIZON_MIN
      ? `Gata ~${formatTargetClock(estimatedReadyAt)}`
      : readyIn > 0
        ? `Gata în ~${readyIn} min`
        : status === "ready_for_pickup" || status === "courier_assigned"
          ? "Gata — se pregătește ridicarea"
          : "Din clipă în clipă";
  const arrive = formatTargetClock(new Date(Date.parse(estimatedReadyAt) + DELIVERY_BUFFER_MIN * 60_000).toISOString());
  return { headline, arrive: `Sosește ~${arrive}` };
}

// ── Courier card ────────────────────────────────────────────────────────────────

/** Name + phone show from assignment until delivery (web `courierActive`). */
export function courierActive(status: string, courierId: string | null): boolean {
  return courierId != null && (status === "courier_assigned" || status === "picked_up" || status === "en_route");
}

export function firstName(fullName: string | null | undefined): string | null {
  const n = fullName?.trim().split(/\s+/)[0];
  return n ? n : null;
}

/** `tel:` URL, or null when there is nothing dialable. */
export function telUrl(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/[^\d+]/g, "") ?? "";
  return /\d{3,}/.test(digits) ? `tel:${digits}` : null;
}

// ── Support (web customer footer) ───────────────────────────────────────────────

export const SUPPORT_EMAIL = "contact@dragonsdelivery.md";
export const SUPPORT_PHONE_LABEL = "+373 60 000 000";
export const SUPPORT_TEL = "tel:+37360000000";

export function supportMailto(orderNumber: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Comanda ${orderNumber}`)}`;
}

// ── Payment line (src/lib/orders/payment.ts) ────────────────────────────────────

export type PaymentNotice = { label: string; detail: string | null; tone: "good" | "warning" };

const METHOD_BASE: Record<string, string> = {
  cash: "cash",
  card_on_delivery: "card la livrare",
  online_gateway: "online",
};

/** What actually happened to the money — read from payment_status, never guessed from the method. */
export function paymentPresence(input: {
  method: string;
  status: string;
  orderStatus: string;
  amountMdl: number | null;
}): { totalLabel: string; notice: PaymentNotice | null } {
  const base = METHOD_BASE[input.method] ?? "plată";
  const amount = input.amountMdl == null ? null : `${input.amountMdl} MDL`;
  const finishedBad = input.orderStatus === "cancelled" || input.orderStatus === "rejected";

  if (input.status === "refunded") {
    return { totalLabel: `${base}, bani returnați`, notice: { label: "Banii ți-au fost returnați", detail: amount, tone: "good" } };
  }
  if (input.status === "refund_pending") {
    return {
      totalLabel: `${base}, returnare în curs`,
      notice: {
        label: "Returnare în curs",
        detail: amount ? `${amount} — ajung înapoi în câteva zile lucrătoare` : "banii ajung înapoi în câteva zile lucrătoare",
        tone: "warning",
      },
    };
  }
  // Paying at the door: `unpaid` is the normal path, not an anomaly — no banner.
  if (input.method !== "online_gateway") return { totalLabel: base, notice: null };
  if (input.status === "paid") return { totalLabel: "plătit online", notice: null };
  if (input.status === "failed") {
    return {
      totalLabel: "online, plată eșuată",
      notice: {
        label: "Plata online nu a trecut",
        detail: finishedBad
          ? "nu ți s-a luat niciun ban"
          : "nu ți s-a luat niciun ban — comanda nu poate porni până nu reiei plata",
        tone: "warning",
      },
    };
  }
  if (input.status === "pending_capture") {
    return {
      totalLabel: "online, rezervat pe card",
      notice: {
        label: "Suma e doar rezervată pe card",
        detail: amount ? `${amount} blocați, încă neîncasați` : "blocată, încă neîncasată",
        tone: "warning",
      },
    };
  }
  if (finishedBad) {
    return { totalLabel: "online, neplătit", notice: { label: "Nu ai fost taxat", detail: "plata online nu a pornit", tone: "good" } };
  }
  return {
    totalLabel: "online, neplătit",
    notice: { label: "Plata online nu s-a finalizat", detail: "comanda nu poate fi livrată până nu trece plata", tone: "warning" },
  };
}

// ── Catering (CateringTracking.tsx) ─────────────────────────────────────────────

// `declined` is the RESTAURANT's decline (decline_catering_quote); the customer has
// no decline RPC — they cancel while pending_restaurant, like any order.
export const QUOTE_LABEL: Record<string, string> = {
  requested: "Cerere trimisă — așteptăm oferta restaurantului",
  quoted: "Ofertă primită — confirmă ca să intre în lucru",
  confirmed: "Ofertă confirmată — comanda e în lucru",
  declined: "Restaurantul a refuzat cererea",
};

/** "2026-10-12" → "12.10.2026" (string math: no Intl/timezone shift on a date-only value). */
export function formatEventDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : isoDate;
}

export function guestsLabel(n: number): string {
  return n === 1 ? "1 invitat" : `${n} invitați`;
}
