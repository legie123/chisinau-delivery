import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { fetchRole, redirectWithSessionCookies, updateSession } from "@/lib/supabase/middleware";
import { isLocalRequestHost, localNoLoginActive } from "@/lib/local/noLogin";
import { APP_HOME, appOrigin, foreignRedirect } from "@/lib/apps/registry";

// Restaurant app (:3003). Owns /restaurant/* only; every path another app owns is
// sent to that app's origin (same hostname, same path + query) — table in
// @/lib/apps/registry. Role gating is UX only: Postgres RLS is the real boundary.
//
// Order: updateSession FIRST (it persists rotated refresh tokens; skipping it on a
// redirect would drop the new token and GoTrue would revoke the session family),
// then ownership, then the /restaurant/* role gate — same semantics as src/proxy.ts.

const REQUIRED_ROLES = ["restaurant_partner", "platform_admin"];

// Dev autologin, restaurant branch of src/proxy.ts (same seed account, same switches).
const DEV_EMAIL = "partener@test.md";
const DEV_PASSWORD = "parola123";

function devAutoLoginEnabled(request: NextRequest): boolean {
  if (process.env.DISABLE_DEV_AUTOLOGIN === "1") return false;
  if (process.env.NODE_ENV !== "production") return isLocalRequestHost(request.headers.get("host"));
  return localNoLoginActive(request.headers.get("host"));
}

// Client bound to the redirect response, not to updateSession's (see src/proxy.ts).
async function signInAsPartner(request: NextRequest): Promise<NextResponse | null> {
  const redirect = NextResponse.redirect(new URL(request.nextUrl.href));
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) =>
          cookiesToSet.forEach(({ name, value, options }) => redirect.cookies.set(name, value, options)),
      },
    },
  );
  await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });
  return error ? null : redirect;
}

export async function proxy(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request);
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host");

  // "/" is the client's hub in the registry, but here (brand link, sign-out landing,
  // the PWA scope root) it means this app's home — stay on this origin.
  if (pathname === "/") return redirectWithSessionCookies(request, response, new URL(APP_HOME.restaurant, request.url));

  const foreign = foreignRedirect("restaurant", request.nextUrl, host);
  if (foreign) return redirectWithSessionCookies(request, response, new URL(foreign));

  if (!(pathname === "/restaurant" || pathname.startsWith("/restaurant/"))) return response;

  if (!user) {
    if (devAutoLoginEnabled(request)) {
      const entered = await signInAsPartner(request);
      if (entered) return entered;
      return new NextResponse(
        "Autentificarea automată de dezvoltare nu a găsit contul de test. Rulează seed-ul local (seeds/local_test_users.sql).",
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return redirectWithSessionCookies(request, response, login);
  }

  const role = await fetchRole(supabase, user.id);

  if (devAutoLoginEnabled(request) && role !== REQUIRED_ROLES[0]) {
    const switched = await signInAsPartner(request);
    if (switched) return switched;
  }

  if (!role || !REQUIRED_ROLES.includes(role)) {
    // Wrong role: the hub lives in the CLIENT app, on the hostname the user came in on.
    const hub = new URL("/", appOrigin("client", host, request.nextUrl.protocol));
    return redirectWithSessionCookies(request, response, hub);
  }

  return response;
}

// Must be a literal here — Next statically reads `config` from this file (keep in sync with src/proxy.ts).
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
