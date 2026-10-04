import type { PlaceOrderInput } from "@chisinau/shared-api";
import { placeOrderItems, type CartState } from "@chisinau/shared-domain";

// The place_order payload, built in ONE place — CartScreen and the smoke script
// (scripts/place-order-smoke.ts) both call this, so what is proven against the DB is
// exactly what the phone sends. Pure: no React Native imports.

export type PaymentChoice = "cash" | "card_on_delivery";
export type TipChoice = "none" | "p10" | "p15" | "p20";

export const TIP_PCT: Record<TipChoice, number> = { none: 0, p10: 0.1, p15: 0.15, p20: 0.2 };

export function tipAmount(subtotal: number, choice: TipChoice): number {
  return Math.round(subtotal * TIP_PCT[choice]);
}

/** One key per checkout attempt: a retry (double tap, timeout) returns the SAME
 *  order from place_order instead of a duplicate. Uniqueness, not secrecy. */
export function newIdempotencyKey(now = Date.now(), rand = Math.random): string {
  return `${now.toString(36)}-${rand().toString(36).slice(2)}-${rand().toString(36).slice(2)}`;
}

export function buildOrderInput(
  cart: CartState,
  opts: { deliveryAddressId: string; paymentMethod: PaymentChoice; idempotencyKey: string; notes?: string },
): PlaceOrderInput {
  if (!cart.restaurantId || cart.lines.length === 0) throw new Error("Coșul este gol.");
  return {
    restaurantId: cart.restaurantId,
    orderType: "standard",
    paymentMethod: opts.paymentMethod,
    items: placeOrderItems(cart.lines),
    deliveryAddressId: opts.deliveryAddressId,
    notes: opts.notes?.trim() || undefined,
    idempotencyKey: opts.idempotencyKey,
  };
}

// ---- new-address draft ----
// A failed place_order (closed at that hour, 1400 MDL cash cap...) can come AFTER the
// address row was inserted. A retry reuses that row only while the draft is exactly
// what was saved — any edit to street/phone/notes/pin means a new row.

export type AddressDraft = { street: string; phone: string; notes: string; pin: { lat: number; lng: number } | null };
export type CreatedAddress = { id: string; fingerprint: string };

export function addressFingerprint(d: AddressDraft): string {
  return JSON.stringify([d.street.trim(), d.phone.trim(), d.notes.trim(), d.pin?.lat ?? null, d.pin?.lng ?? null]);
}

export function reusableAddressId(created: CreatedAddress | null, draft: AddressDraft): string | null {
  return created && created.fingerprint === addressFingerprint(draft) ? created.id : null;
}

/** The first saved address is a default, never an override: once the user picked a
 *  chip or typed a new address (e.g. before the Login detour), their choice stands. */
export function defaultAddressChoice(current: string, saved: { id: string }[], touched: boolean): string {
  return !touched && current === "new" && saved.length > 0 ? saved[0].id : current;
}

/** Double-tap guard: the lock is taken synchronously, before the first await, so a
 *  second tap in the same frame finds it held and does nothing. */
export async function runExclusive(lock: { current: boolean }, fn: () => Promise<void>): Promise<void> {
  if (lock.current) return;
  lock.current = true;
  try {
    await fn();
  } finally {
    lock.current = false;
  }
}
