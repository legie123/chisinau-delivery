// Server-safe routing: fetches a real road route + travel time from an OSRM
// server, with a straight-line + estimated-time fallback so the caller always
// gets a usable result. No React here — importable from Route Handlers and the
// client hook alike. `getRoute` NEVER throws.

export type RoutePoint = { lat: number; lng: number };

export type RouteResult = {
  // Polyline points as [lat, lng] (Leaflet order), start → end.
  line: [number, number][];
  durationSec: number;
  distanceM: number;
  source: "osrm" | "fallback";
};

// Earth radius (m). Haversine great-circle distance between two points.
// Exported so the client hook can measure endpoint movement for debouncing.
export function haversineM(from: RoutePoint, to: RoutePoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// OSRM base URL — server-controlled, with a sensible public default. Prefer a
// non-public first (`OSRM_URL`) so production can point at a private router.
function osrmBase(): string {
  return (
    process.env.OSRM_URL ||
    process.env.NEXT_PUBLIC_OSRM_URL ||
    "https://router.project-osrm.org"
  );
}

// Straight line + rough ETA. 22 km/h ≈ an urban scooter weaving through
// Chișinău traffic — good enough when the router is down.
export function straightLineFallback(from: RoutePoint, to: RoutePoint, kmh = 22): RouteResult {
  const distanceM = haversineM(from, to);
  return {
    line: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    distanceM,
    durationSec: distanceM / ((kmh * 1000) / 3600),
    source: "fallback",
  };
}

// Query OSRM for a real driving route. Returns null on ANY error/timeout/empty
// response so the caller can fall back cleanly. 3.5s abort keeps a slow router
// from stalling the map.
export async function fetchOsrmRoute(from: RoutePoint, to: RoutePoint): Promise<RouteResult | null> {
  const url =
    `${osrmBase()}/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: { geometry?: { coordinates?: [number, number][] }; duration?: number; distance?: number }[];
    };
    const route = json.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (!route || !coords?.length || typeof route.duration !== "number" || typeof route.distance !== "number") {
      return null;
    }
    return {
      // OSRM returns [lng, lat]; Leaflet wants [lat, lng].
      line: coords.map(([lng, lat]) => [lat, lng] as [number, number]),
      durationSec: route.duration,
      distanceM: route.distance,
      source: "osrm",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The one entry point: real route when possible, straight-line estimate
// otherwise. Never throws.
export async function getRoute(from: RoutePoint, to: RoutePoint): Promise<RouteResult> {
  const osrm = await fetchOsrmRoute(from, to);
  return osrm ?? straightLineFallback(from, to);
}
