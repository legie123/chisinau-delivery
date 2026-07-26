// Server-side geocoding via Nominatim (OpenStreetMap) — turns a restaurant's
// street address into lat/lng so dispatch scoring + nearby-browse use its REAL
// position instead of the 6 km fallback. Free, no API key. Restricted to Moldova
// (countrycodes=md) so a bare street name resolves inside Chișinău.
//
// Nominatim usage policy: a valid, identifying User-Agent is REQUIRED and calls
// must stay under ~1 req/sec. Onboarding is occasional (an operator creating a
// restaurant), so we're well within limits. This is SERVER-ONLY (called from the
// admin Server Action) — never ship the address off to OSM from the browser.

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "chisinau-delivery/1.0 (restaurant onboarding geocoder)";

export type GeocodeResult = {
  lat: number;
  lng: number;
  displayName: string;
};

/**
 * Geocode a Chișinău street address. Returns null on any failure (no match,
 * network error, timeout, malformed response) so the caller can fall back to
 * saving without coordinates — geocoding must NEVER block onboarding.
 *
 * @param address the free-text street address (e.g. "Strada București 67")
 * @param city    defaults to Chișinău
 */
export async function geocodeAddress(address: string, city = "Chișinău"): Promise<GeocodeResult | null> {
  const query = `${address.trim()}, ${city}, Moldova`;
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=md&addressdetails=1`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const top = data[0] as { lat?: string; lon?: string; display_name?: string };
    const lat = Number(top.lat);
    const lng = Number(top.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    // Sanity clamp: Moldova bounds (roughly 45.4–48.5 N, 26.6–30.2 E). A hit
    // outside these is a geocoder miss, not a Chișinău restaurant — reject it so
    // dispatch never gets a wildly wrong position.
    if (lat < 45.4 || lat > 48.5 || lng < 26.6 || lng > 30.2) return null;

    return { lat, lng, displayName: top.display_name ?? query };
  } catch {
    return null;
  }
}
