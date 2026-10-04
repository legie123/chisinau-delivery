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

/** Same mapping as the web CheckoutForm: raw pg text -> Romanian copy. */
export function friendlyPlaceOrderError(raw: string): string {
  if (raw.includes("below minimum")) return "Comanda nu atinge minimul restaurantului.";
  if (raw.includes("not currently accepting")) return "Restaurantul nu acceptă comenzi momentan.";
  if (raw.includes("1400 MDL")) return "Comenzile peste 1400 MDL se achită cu cardul la livrare — alege «Card (POS)».";
  if (raw.includes("închis la ora")) return "Restaurantul este închis acum. Alege alt restaurant sau revino mai târziu.";
  if (raw.includes("menu item unavailable")) return "Un articol din coș nu mai este disponibil — reîncarcă meniul.";
  if (raw.includes("alege o opțiune")) return "Un produs are opțiuni obligatorii neconfigurate — scoate-l și adaugă-l din nou.";
  if (raw.includes("obligatorie") || raw.includes("autentificat") || raw.includes("livrării") || raw.includes("adresa")) return raw;
  return "Nu am putut trimite comanda. Încearcă din nou.";
}
