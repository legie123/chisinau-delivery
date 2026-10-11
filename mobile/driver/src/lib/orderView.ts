// Pure helpers for what the courier sees: real points (never synthesized),
// door details, and the external navigation/call links. No React Native here,
// so tests/orderView.test.ts runs them in node.

export type LatLng = { lat: number; lng: number };

/** A real map point, or null. Never invents a coordinate when one is missing. */
export function toPoint(lat: unknown, lng: unknown): LatLng | null {
  if (lat == null || lng == null) return null;
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b } : null;
}

/** Google Maps directions to the pin; the typed address in Chișinău when there is no pin. */
export function navUrl(point: LatLng | null, addressText: string | null | undefined): string | null {
  if (point) return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`;
  const text = addressText?.trim();
  return text ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${text}, Chișinău`)}` : null;
}

export function telUrl(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/[^\d+]/g, "") ?? "";
  return digits ? `tel:${digits}` : null;
}

export type DoorAddress = {
  street_address: string;
  building?: string | null;
  entrance?: string | null;
  floor?: string | null;
  apartment?: string | null;
  intercom_code?: string | null;
};

/** Street on one line, everything needed at the door on the next. */
export function addressLines(a: DoorAddress): { street: string; door: string } {
  const door = [
    a.building && `bloc ${a.building}`,
    a.entrance && `scara ${a.entrance}`,
    a.floor && `etaj ${a.floor}`,
    a.apartment && `ap. ${a.apartment}`,
    a.intercom_code && `interfon ${a.intercom_code}`,
  ]
    .filter(Boolean)
    .join(", ");
  return { street: a.street_address, door };
}
