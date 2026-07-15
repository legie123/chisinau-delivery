import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// DEV/DEMO doorway: the hub's three sectors enter the app WITHOUT a login
// form by signing in server-side with the seeded test accounts. RLS and all
// flows behave exactly as with a real login. Remove before public launch
// (tracked in docs/LOOP_STATE.md).
const SECTOR: Record<string, { email: string; to: string }> = {
  client: { email: "client@test.md", to: "/restaurants" },
  curier: { email: "curier@test.md", to: "/deliveries" },
  restaurant: { email: "partener@test.md", to: "/restaurant/orders" },
};

const DEMO_PASSWORD = "parola123";

export async function GET(request: NextRequest, { params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  const sector = SECTOR[role];
  if (!sector) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.redirect(new URL(sector.to, request.url));

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
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(sector.to)}`, request.url));
  }

  return response;
}
