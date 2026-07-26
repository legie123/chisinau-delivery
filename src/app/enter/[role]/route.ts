import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// DEV/DEMO doorway (POST-only: GET would be executed by Link prefetch in
// production and is trivially CSRF-able). The hub's three sectors enter WITHOUT a login
// form by signing in server-side with the seeded test accounts. RLS and all
// flows behave exactly as with a real login. Remove before public launch
// (tracked in docs/LOOP_STATE.md).
const SECTOR: Record<string, { email: string; to: string }> = {
  client: { email: "client@test.md", to: "/restaurants" },
  curier: { email: "curier@test.md", to: "/deliveries" },
  restaurant: { email: "partener@test.md", to: "/restaurant/orders" },
  platform: { email: "admin@test.md", to: "/platform" },
};

const DEMO_PASSWORD = "parola123";

export async function POST(request: NextRequest, { params }: { params: Promise<{ role: string }> }) {
  // Master Council Phase 0: the passwordless demo doorway must not exist in
  // production — real users go through /login (sign-in + sign-up). It stays fully
  // functional on local/dev/staging for testing.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { role } = await params;
  const sector = SECTOR[role];
  if (!sector) {
    return NextResponse.redirect(new URL("/", request.url), 303);
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
    password: DEMO_PASSWORD,
  });

  if (error) {
    // Keep the signOut cookie deletions — they were written onto `response`;
    // without copying them the browser retains cookies for a token that was
    // just revoked server-side. No login form for now → fall back to the hub.
    const errorResponse = NextResponse.redirect(new URL("/", request.url), 303);
    response.cookies.getAll().forEach((cookie) => errorResponse.cookies.set(cookie));
    return errorResponse;
  }

  return response;
}
