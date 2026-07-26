// Branded ID types — zero runtime cost, compile-time protection against the
// classic "passed an orderId where an offerId was expected" bug (which would
// otherwise fail at runtime inside a 30-second offer window on a courier's phone).
declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type OrderId = Brand<string, "OrderId">;
export type OfferId = Brand<string, "OfferId">;
export type CourierId = Brand<string, "CourierId">;
export type RestaurantId = Brand<string, "RestaurantId">;

// Boundary casts — use where a plain string enters the typed world (route params,
// realtime payloads, form data). Purely nominal; no validation.
export const asOrderId = (id: string): OrderId => id as OrderId;
export const asOfferId = (id: string): OfferId => id as OfferId;
export const asCourierId = (id: string): CourierId => id as CourierId;
export const asRestaurantId = (id: string): RestaurantId => id as RestaurantId;
