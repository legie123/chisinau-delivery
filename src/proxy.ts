import { NextResponse, type NextRequest } from "next/server";
import { fetchRole, redirectWithSessionCookies, updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts` (the
// exported function is `proxy`, not `middleware`). This is our role-gate
// checkpoint for the courier/admin surfaces — a UX convenience, NOT the
// security boundary — Postgres RLS (has_role/has_any_role/has_restaurant_access)
// is what actually enforces access on every table.
//
// The matcher below only targets gated paths, so public pages (marketing,
// login, customer browsing) never depend on Supabase being reachable —
// their own Server/Client Components create their own Supabase client
// on demand and degrade gracefully if it's unavailable.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const requiredRoles = pathname.startsWith("/deliveries")
    ? ["courier", "platform_admin"]
    : pathname.startsWith("/restaurant/")
      ? ["restaurant_partner", "platform_admin"]
      : pathname.startsWith("/platform/")
        ? ["platform_admin"]
        : null;

  if (!requiredRoles) return NextResponse.next();

  const { response, user, supabase } = await updateSession(request);

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return redirectWithSessionCookies(request, response, loginUrl);
  }

  const role = await fetchRole(supabase, user.id);
  if (!role || !requiredRoles.includes(role)) {
    return redirectWithSessionCookies(request, response, new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/deliveries/:path*", "/restaurant/:path*", "/platform/:path*"],
};
