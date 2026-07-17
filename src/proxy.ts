import type { NextRequest } from "next/server";
import { fetchRole, redirectWithSessionCookies, updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts` (the
// exported function is `proxy`, not `middleware`).
//
// This runs on EVERY non-static route — not just the gated ones — because
// updateSession() is what persists rotated refresh tokens back into cookies.
// Server Components can't write cookies, so if a customer page's getUser()
// triggers a token rotation and the proxy didn't cover that route, the new
// token would be silently discarded and GoTrue's reuse detection would
// revoke the whole session family on the next navigation (forced logout).
//
// Role gating below is UX only — Postgres RLS is the real security boundary.
export async function proxy(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const requiredRoles = pathname.startsWith("/deliveries") || pathname === "/earnings"
    ? ["courier", "platform_admin"]
    : pathname.startsWith("/restaurant/")
      ? ["restaurant_partner", "platform_admin"]
      : pathname === "/platform" || pathname.startsWith("/platform/")
        ? ["platform_admin"]
        : null;

  if (!requiredRoles) return response;

  if (!user) {
    // No login form for now — an unauthenticated hit on a gated surface goes
    // back to the hub, where the three sectors enter passwordlessly.
    return redirectWithSessionCookies(request, response, new URL("/", request.url));
  }

  const role = await fetchRole(supabase, user.id);
  if (!role || !requiredRoles.includes(role)) {
    return redirectWithSessionCookies(request, response, new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
