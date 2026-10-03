import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { MASTER_COOKIE, masterCookieValue, masterDoorwayEnabled, masterPasswordRequired } from "@/lib/master/gate";

// Same sector map as the dev doorway (src/app/enter/[role]/route.ts): each role
// signs in server-side with its seeded test account and lands on that surface.
const SECTOR: Record<string, { email: string; to: string }> = {
  client: { email: "client@test.md", to: "/restaurants" },
  curier: { email: "curier@test.md", to: "/deliveries" },
  restaurant: { email: "partener@test.md", to: "/restaurant/orders" },
  platform: { email: "admin@test.md", to: "/platform" },
};

const SEED_PASSWORD = "parola123";

// POST /master/enter/<role> — one-click entry from the authed master doorway.
// Gate is the env flag + master cookie (NOT NODE_ENV), so it works on the local
// production-mode server.
export async function POST(request: NextRequest, { params }: { params: Promise<{ role: string }> }) {
  if (!masterDoorwayEnabled()) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  // Require a valid master session cookie.
  // În dezvoltare sari peste dovada de parolă: poarta e deschisă (vezi gate.ts).
  const expected = masterCookieValue();
  const cookie = request.cookies.get(MASTER_COOKIE)?.value;
  if (masterPasswordRequired(request.headers.get("host")) && (expected === null || cookie !== expected)) {
    return NextResponse.redirect(new URL("/master", request.url), 303);
  }

  const { role } = await params;
  const sector = SECTOR[role];
  if (!sector) {
    return NextResponse.redirect(new URL("/master", request.url), 303);
  }

  const response = NextResponse.redirect(new URL(sector.to, request.url), 303);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Drop any previous role's session, then enter as the chosen sector.
  await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.signInWithPassword({
    email: sector.email,
    password: SEED_PASSWORD,
  });

  if (error) {
    // Preserve the signOut cookie deletions written onto `response`, otherwise
    // the browser keeps cookies for a just-revoked token. Fall back to /master.
    const errorResponse = NextResponse.redirect(new URL("/master", request.url), 303);
    response.cookies.getAll().forEach((cookie) => errorResponse.cookies.set(cookie));
    return errorResponse;
  }

  return response;
}
