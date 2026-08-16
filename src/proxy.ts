import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
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

// ---------------------------------------------------------------------------
// Autentificare automată în DEZVOLTARE (cerută 2026-08-16: „dezactivează
// login-ul de la toate secțiunile deocamdată").
//
// Nu se poate pur și simplu „lăsa să treacă": RLS filtrează după utilizatorul
// din sesiune, deci un vizitator anonim ar vedea panouri goale, nu deblocate.
// În schimb, secțiunea se autentifică singură cu contul de test al rolului ei,
// exact ca poarta /enter/[role] — aceleași conturi seed, aceleași politici,
// aceleași fluxuri.
//
// PLASA DE SIGURANȚĂ: nimic din asta nu rulează în producție. Acolo se cade pe
// comportamentul normal — redirect la /login cu întoarcere la destinație.
// Ca să reactivezi login-ul și local, șterge blocul marcat mai jos (sau
// pornește serverul cu DISABLE_DEV_AUTOLOGIN=1).
// ---------------------------------------------------------------------------
const DEV_ACCOUNTS: Record<string, string> = {
  courier: "curier@test.md",
  restaurant_partner: "partener@test.md",
  platform_admin: "admin@test.md",
  customer: "client@test.md",
};
const DEV_PASSWORD = "parola123";

function devAutoLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DISABLE_DEV_AUTOLOGIN !== "1";
}

/**
 * Intră pe contul de test al rolului și întoarce un redirect care POARTĂ
 * cookie-urile noii sesiuni.
 *
 * Clientul e legat direct de răspunsul de redirect, nu de cel din
 * `updateSession`: acela își reasignează intern obiectul de răspuns la fiecare
 * scriere de cookie, așa că referința întoarsă apelantului rămâne cea de
 * dinainte de autentificare — cookie-urile se pierdeau și ruta se relua la
 * infinit (307 în buclă, prins la prima probă).
 */
async function signInAs(request: NextRequest, role: string): Promise<NextResponse | null> {
  const email = DEV_ACCOUNTS[role];
  if (!email) return null;

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
  const { error } = await supabase.auth.signInWithPassword({ email, password: DEV_PASSWORD });
  return error ? null : redirect;
}

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
    if (devAutoLoginEnabled()) {
      // Intră singură pe rolul cerut de rută, apoi reîncarcă aceeași adresă.
      const entered = await signInAs(request, requiredRoles[0]);
      if (entered) return entered;
      // Conturile de test lipsesc (bază proaspătă, fără seed): spune-o pe față,
      // în loc să arunce omul într-un login pe care tocmai l-am dezactivat.
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
  if (!role || !requiredRoles.includes(role)) {
    // În dezvoltare, un rol greșit nu trebuie să te arunce la hub: schimbă
    // sesiunea pe rolul secțiunii în care ai intrat.
    if (devAutoLoginEnabled()) {
      const switched = await signInAs(request, requiredRoles[0]);
      if (switched) return switched;
    }
    return redirectWithSessionCookies(request, response, new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
