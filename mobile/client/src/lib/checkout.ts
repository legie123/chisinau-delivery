import type { PlaceOrderInput } from "@chisinau/shared-api";
import { isOpenNow, placeOrderItems, type CartState, type HoursRow } from "@chisinau/shared-domain";

// The place_order payload, built in ONE place — CartScreen and the smoke script
// (scripts/place-order-smoke.ts) both call this, so what is proven against the DB is
// exactly what the phone sends. Pure: no React Native imports.

export type PaymentChoice = "cash" | "card_on_delivery";
export type TipChoice = "none" | "p10" | "p15" | "p20";

export const TIP_PCT: Record<TipChoice, number> = { none: 0, p10: 0.1, p15: 0.15, p20: 0.2 };

export function tipAmount(subtotal: number, choice: TipChoice): number {
  return Math.round(subtotal * TIP_PCT[choice]);
}

/** Web CheckoutForm rule: a custom MDL amount (> 0) wins over the preset percentage. */
export function tipFor(subtotal: number, choice: TipChoice, customRaw: string): number {
  const custom = Math.max(0, Math.round(Number(customRaw.replace(",", ".")) || 0));
  return custom > 0 ? custom : tipAmount(subtotal, choice);
}

// ---- cash cap (place_order, 20260813000400_cash_gate_fixes.sql) ----
// place_order rejects standard + cash when subtotal + delivery fee (tip NOT counted)
// exceeds 1400 MDL. The server stays the authority; this only says it first.
// ponytail: mirrors the SQL literal; read it from config once the cap is versioned.
export const CASH_CAP_MDL = 1400;
export const CASH_CAP_HINT = "Comenzile peste 1400 MDL se achită cu cardul la livrare — alege «Card (POS)».";

export function cashCapExceeded(payment: PaymentChoice, subtotal: number, deliveryFee: number): boolean {
  return payment === "cash" && subtotal + deliveryFee > CASH_CAP_MDL;
}

// ---- remembered checkout choices (web: chisinau-last-payment / chisinau-last-tip) ----

export type CheckoutPrefs = { payment: PaymentChoice; tip: TipChoice; customTip: string };

/** Whatever storage returned → only the values the checkout can still offer. */
export function parsePrefs(raw: string | null): Partial<CheckoutPrefs> {
  try {
    const p = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
    if (!p || typeof p !== "object") return {};
    const out: Partial<CheckoutPrefs> = {};
    if (p.payment === "cash" || p.payment === "card_on_delivery") out.payment = p.payment;
    if (typeof p.tip === "string" && Object.prototype.hasOwnProperty.call(TIP_PCT, p.tip)) out.tip = p.tip as TipChoice;
    if (typeof p.customTip === "string" && /^\d{1,5}$/.test(p.customTip)) out.customTip = p.customTip;
    return out;
  } catch {
    return {};
  }
}

// ---- scheduled delivery (place_order p_requested_for) ----
// The window is the web's + place_order's: strictly in the future (web CheckoutForm)
// and the restaurant open at that moment (restaurant_open_at(coalesce(p_requested_for, now()))).
// Picker values are Chișinău wall-clock time, whatever zone the phone is in.

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const pad = (n: number) => String(n).padStart(2, "0");
const zoneFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Chisinau",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function zoned(d: Date) {
  const parts = zoneFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: +get("year"), mo: +get("month"), d: +get("day"), h: +get("hour") % 24, mi: +get("minute"), s: +get("second"), dow: DOW[get("weekday")] ?? 0 };
}

/** day_of_week + "HH:MM:SS" in Chișinău at instant `d` (the restaurant_hours frame). */
export function chisinauClock(d: Date): { dow: number; time: string } {
  const z = zoned(d);
  return { dow: z.dow, time: `${pad(z.h)}:${pad(z.mi)}:${pad(z.s)}` };
}

/** "YYYY-MM-DD" + "HH:MM" read as Chișinău wall time → the instant; null if malformed. */
export function chisinauWallTime(date: string, time: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const wall = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const z = zoned(new Date(guess));
    guess += wall - Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s);
  }
  return new Date(guess);
}

/** What place_order (or the web form) would reject about this time; null = sendable.
 *  `hours` null = not loaded: the server still checks, we just can't say it first. */
export function scheduleProblem(when: Date | null, hours: HoursRow[] | null, now = Date.now()): string | null {
  if (!when) return "Alege data și ora livrării.";
  if (when.getTime() <= now) return "Ora livrării trebuie să fie în viitor.";
  if (hours) {
    const c = chisinauClock(when);
    if (!isOpenNow(hours, c.dow, c.time)) return "Restaurantul este închis la ora aleasă — alege altă oră.";
  }
  return null;
}

/** One key per checkout attempt: a retry (double tap, timeout) returns the SAME
 *  order from place_order instead of a duplicate. Uniqueness, not secrecy. */
export function newIdempotencyKey(now = Date.now(), rand = Math.random): string {
  return `${now.toString(36)}-${rand().toString(36).slice(2)}-${rand().toString(36).slice(2)}`;
}

export function buildOrderInput(
  cart: CartState,
  opts: { deliveryAddressId: string; paymentMethod: PaymentChoice; idempotencyKey: string; notes?: string; requestedFor?: string },
): PlaceOrderInput {
  if (!cart.restaurantId || cart.lines.length === 0) throw new Error("Coșul este gol.");
  return {
    restaurantId: cart.restaurantId,
    orderType: "standard",
    paymentMethod: opts.paymentMethod,
    items: placeOrderItems(cart.lines),
    deliveryAddressId: opts.deliveryAddressId,
    notes: opts.notes?.trim() || undefined,
    requestedFor: opts.requestedFor,
    idempotencyKey: opts.idempotencyKey,
  };
}

// ---- new-address draft ----
// A failed place_order (closed at that hour, 1400 MDL cash cap...) can come AFTER the
// address row was inserted. A retry reuses that row only while the draft is exactly
// what was saved — any edit to any field or the pin means a new row.

// The extra fields are the web checkout's (sector / bloc / apartament) + the label it shows.
export type AddressFields = { label?: string; sector?: string; building?: string; apartment?: string };
export type AddressDraft = AddressFields & { street: string; phone: string; notes: string; pin: { lat: number; lng: number } | null };
export type CreatedAddress = { id: string; fingerprint: string };

export function addressFingerprint(d: AddressDraft): string {
  const extra = [d.label, d.sector, d.building, d.apartment].map((v) => (v ?? "").trim());
  return JSON.stringify([d.street.trim(), d.phone.trim(), d.notes.trim(), d.pin?.lat ?? null, d.pin?.lng ?? null, ...extra]);
}

export function reusableAddressId(created: CreatedAddress | null, draft: AddressDraft): string | null {
  return created && created.fingerprint === addressFingerprint(draft) ? created.id : null;
}

/** Romanian reason the draft can't be saved; null = ok. Phone: the courier must be able to call. */
export function addressDraftProblem(d: AddressDraft): string | null {
  if (!d.street.trim()) return "Adresa este obligatorie.";
  if (d.phone.replace(/\D/g, "").length < 6) return "Lasă un telefon de contact — curierul trebuie să te poată suna la livrare.";
  return null;
}

/** The addresses row for a draft. Empty optional fields are NULL, not ""; lat/lng only with a pin. */
export function addressRow(d: AddressDraft) {
  const opt = (v?: string) => v?.trim() || null;
  return {
    street_address: d.street.trim(),
    contact_phone: d.phone.trim(),
    notes: opt(d.notes),
    label: opt(d.label),
    sector: opt(d.sector),
    building: opt(d.building),
    apartment: opt(d.apartment),
    ...(d.pin ?? {}),
  };
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
