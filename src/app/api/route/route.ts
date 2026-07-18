import { NextResponse, type NextRequest } from "next/server";
import { getRoute, type RoutePoint } from "@/lib/routing/route";

// Server-side routing proxy: the client hook calls this instead of OSRM directly
// so there's no browser CORS dependency and the OSRM URL stays server-controlled
// (a private router in production never leaks to the client bundle).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Parse a `lat,lng` query pair into a RoutePoint, or null if missing/NaN.
function parsePoint(raw: string | null): RoutePoint | null {
  if (!raw) return null;
  const [latStr, lngStr] = raw.split(",");
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = parsePoint(searchParams.get("from"));
  const to = parsePoint(searchParams.get("to"));
  if (!from || !to) {
    return NextResponse.json({ error: "missing or invalid from/to" }, { status: 400 });
  }

  const result = await getRoute(from, to);
  // Short shared-cache window: a live courier moves, but 30s of edge cache
  // collapses bursty refetches without showing a stale route.
  return NextResponse.json(result, {
    headers: { "Cache-Control": "s-maxage=30" },
  });
}
