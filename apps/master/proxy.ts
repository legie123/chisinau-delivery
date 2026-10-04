import { NextResponse, type NextRequest } from "next/server";
import { proxy as monolithProxy } from "@/proxy";
import { APP_HOME, appOrigin, foreignRedirect } from "@/lib/apps/registry";
import { fetchRole, redirectWithSessionCookies, updateSession } from "@/lib/supabase/middleware";
import { VIEW_HOME, VIEW_PREFIX, fromViewPath } from "@/lib/viewAs/paths";
import { VIEW_AS_COOKIE, readViewerToken } from "@/lib/viewAs/token";

// Master shell (:3004). Owns /platform/*, /master/*, /api/platform/*, /view/* (src/lib/apps/registry.ts).
// Role gating here is UX only — RLS is the boundary, and the ai route re-checks inside.

const isUnder = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

function deny(status: 401 | 403, body: string, session: NextResponse) {
  const res = new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
  // Keep any token rotation updateSession just wrote, or GoTrue revokes the family next time.
  session.cookies.getAll().forEach((cookie) => res.cookies.set(cookie));
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname, search, protocol } = request.nextUrl;

  // No hub here: "/" is the ops console. Checked first — the registry gives "/" to the client.
  if (pathname === "/") {
    const home = request.nextUrl.clone();
    home.pathname = APP_HOME.master;
    return NextResponse.redirect(home);
  }

  // Foreign path → owner app, same hostname (the auth cookie is host-scoped), same path + query.
  const foreign = foreignRedirect("master", { pathname, search, protocol }, request.headers.get("host"));
  if (foreign) return NextResponse.redirect(foreign);

  // View-as (/view/*): a monolith page for the viewed user, read-only by the DB role `viewer`.
  // Gate: a valid viewer token minted for the admin signed in right now, and a page that this
  // surface's view shows. Anything else → back to the picker, cookie cleared.
  if (isUnder(pathname, VIEW_PREFIX)) {
    const { response, user } = await updateSession(request);
    const claims = readViewerToken(request.cookies.get(VIEW_AS_COOKIE)?.value);
    if (!claims || !user || claims.act.sub !== user.id) {
      const res = redirectWithSessionCookies(request, response, new URL("/platform/view-as?e=expirat", request.url));
      res.cookies.set(VIEW_AS_COOKIE, "", { path: VIEW_PREFIX, maxAge: 0 });
      return res;
    }
    if (pathname === VIEW_PREFIX || !fromViewPath(claims.view_as_app, pathname)) {
      const home = new URL(VIEW_PREFIX + VIEW_HOME[claims.view_as_app], request.url);
      return redirectWithSessionCookies(request, response, home);
    }
    return response;
  }

  // /platform: the monolith gate as-is — platform_admin only, dev autologin admin@test.md,
  // production without a session → /login?next=.
  if (isUnder(pathname, "/platform")) {
    const res = await monolithProxy(request);
    // Wrong role → the monolith sends "/" (its hub). Here "/" is /platform again, so that
    // would loop; the hub is the client app's "/" — same hostname, cookies kept on `res`.
    const location = res.headers.get("location");
    if (location && new URL(location, request.url).pathname === "/") {
      res.headers.set("location", `${appOrigin("client", request.headers.get("host"), protocol)}/`);
    }
    return res;
  }

  const { response, user, supabase } = await updateSession(request);

  // JSON surface: answer with a status, never a redirect to an HTML page.
  if (isUnder(pathname, "/api/platform")) {
    if (!user) return deny(401, "Neautentificat.", response);
    if ((await fetchRole(supabase, user.id)) !== "platform_admin") {
      return deny(403, "Doar pentru administratorul platformei.", response);
    }
  }

  // /master keeps its own doorway gate (masterPasswordRequired); /login and shared assets
  // only need the session refresh. No customer autologin in this app.
  return response;
}

// Must be a literal here — Next statically reads `config` from this file (keep in sync with src/proxy.ts).
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
