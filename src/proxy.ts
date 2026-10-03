import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { fetchRole, redirectWithSessionCookies, updateSession } from "@/lib/supabase/middleware";
import { isLocalRequestHost, localNoLoginActive } from "@/lib/local/noLogin";

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
// PLASA DE SIGURANȚĂ: pe un build de producție nu rulează nimic din asta — se
// cade pe comportamentul normal, redirect la /login cu întoarcere la destinație.
// SINGURA excepție, adăugată 2026-08-25 fiindcă serverul local de pe :3000 e el
// însuși un build de producție: `LOCAL_NO_LOGIN=1` ÎMPREUNĂ cu o cerere venită
// de pe localhost. Ambele condiții, niciodată una singură — vezi motivul scris
// pe îndelete în `@/lib/local/noLogin`.
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

// Suprafețe care NU trebuie autentificate automat — vezi motivul la apel.
const AUTH_SURFACES = ["/login", "/api", "/enter", "/master"];

// Suprafețele sectorului CLIENT care depind de identitate. Lista e restrânsă
// intenționat: răsfoirea (/restaurants, /concierge) merge cu orice sesiune, deci
// n-are rost s-o plătim cu o interogare de rol pe fiecare pagină publică, iar
// hub-ul lipsește dinadins — altfel dus-întorsul hub → sector → hub ar reloga la
// fiecare pas.
const CUSTOMER_SURFACES = ["/orders", "/cart", "/checkout", "/catering", "/concierge/rezervari"];

const isUnder = (pathname: string, surfaces: string[]) =>
  surfaces.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * Autologin pornit pentru cererea asta.
 *
 * Două drumuri, nu unul, fiindcă „local" și „dezvoltare" nu mai sunt același
 * lucru de când serverul de pe :3000 e un build de PRODUCȚIE pornit de launchd:
 *   - server de dezvoltare (`next dev`, :3007) — ca până acum, deschis;
 *   - build de producție — închis, EXCEPTÂND cazul în care e pornit explicit cu
 *     `LOCAL_NO_LOGIN=1` ȘI cererea vine chiar de pe mașina asta.
 *
 * `DISABLE_DEV_AUTOLOGIN=1` rămâne comutatorul care le stinge pe amândouă, deci
 * felul de a-ți cere login-ul înapoi n-a devenit mai complicat.
 */
function devAutoLoginEnabled(request: NextRequest): boolean {
  if (process.env.DISABLE_DEV_AUTOLOGIN === "1") return false;
  // Dev too: only for a request addressed to this machine. The server is bound to loopback,
  // but processes in the Colima VM reach it via host.docker.internal, and a DNS-rebinding page
  // would arrive with its own hostname — neither should get an auto-logged-in session.
  if (process.env.NODE_ENV !== "production") return isLocalRequestHost(request.headers.get("host"));
  return localNoLoginActive(request.headers.get("host"));
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

  if (!requiredRoles) {
    // Suprafața CLIENTULUI nu e păzită de proxy (răsfoirea meniului e publică
    // prin proiect, și așa trebuie să rămână în producție), dar „nepăzit" nu
    // înseamnă „deblocat": RLS filtrează după utilizatorul din sesiune, deci
    // /orders, /cart, /checkout, /catering și /concierge/rezervari afișau
    // „Intră din sectorul Clienți…" — un perete de login pe un sector despre
    // care tocmai am spus că n-are login. Aceeași plasă ca mai jos, același
    // cont de test, doar în dezvoltare.
    //
    // Rutele de autentificare rămân pe dinafară: un redirect emis DE PE /login
    // înapoi pe /login se reia la infinit, iar /api ar primi un 307 în locul
    // răspunsului JSON. /enter și /master își au propriile porți.
    if (devAutoLoginEnabled(request) && !isUnder(pathname, AUTH_SURFACES)) {
      if (!user) {
        const entered = await signInAs(request, "customer");
        if (entered) return entered;
      } else if (isUnder(pathname, CUSTOMER_SURFACES)) {
        // Celălalt capăt al aceluiași defect ca la sectoarele păzite: venind din
        // sectorul curierului, sesiunea rămâne a curierului, iar „Comenzile
        // mele" ar arăta comenzile ALTCUIVA — un sector deschis care spune un
        // neadevăr, nu unul care cere login. Rolul se citește doar aici, nu pe
        // fiecare pagină publică.
        const role = await fetchRole(supabase, user.id);
        if (role !== "customer") {
          const switched = await signInAs(request, "customer");
          if (switched) return switched;
        }
      }
    }
    return response;
  }

  if (!user) {
    if (devAutoLoginEnabled(request)) {
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

  // FLUX CONTINUU DE PERMISIUNI (cerut 2026-08-25). Cât login-ul e oprit local,
  // ținta nu e „un rol acceptat de poartă", ci rolul PROPRIU al sectorului —
  // `requiredRoles[0]`. Diferența nu e formală, e cea care golea sectorul:
  // `platform_admin` trece de poarta curierului fiindcă e trecut în
  // `requiredRoles`, deci vechea condiție („rolul e printre cele acceptate")
  // nu schimba nimic și te lăsa înăuntru ca admin. Dar un curier nu e un rol în
  // `profiles`, e un RÂND în `couriers` (regula casei din CLAUDE.md #5), iar
  // adminul n-are unul — măsurat în baza locală: curier@test.md are rând,
  // admin@test.md nu. De acolo venea „Contul tău nu este înregistrat ca curier.
  // Contactează un administrator." pe un sector care tocmai se declarase deschis.
  //
  // Schimbul nu se poate relua la infinit: fiecare cont din DEV_ACCOUNTS are
  // exact rolul sub care e trecut, deci după schimb condiția e falsă.
  if (devAutoLoginEnabled(request) && role !== requiredRoles[0]) {
    const switched = await signInAs(request, requiredRoles[0]);
    if (switched) return switched;
  }

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
