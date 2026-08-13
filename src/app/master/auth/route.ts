import { NextResponse, type NextRequest } from "next/server";
import {
  MASTER_COOKIE,
  checkMasterCredentials,
  masterCookieValue,
  masterDoorwayEnabled,
} from "@/lib/master/gate";

const ONE_YEAR = 60 * 60 * 24 * 365;

// Armata 2026-08-14 (MED): /master/auth accepta încercări nelimitate. Limitator
// per-IP în memorie: 5 eșecuri → lacăt 15 minute. Pe serverless memoria e
// per-instanță (limita se resetează la instanță nouă) — tot taie brute-force-ul
// susținut de pe o singură cale; pentru garanții tari se pune rate-limit și în
// fața reverse-proxy-ului.
const FAIL_LIMIT = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; lockedUntil: number }>();

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

// POST /master/auth — master login + logout.
// Disabled feature → behave as if the route doesn't exist (redirect home).
export async function POST(request: NextRequest) {
  if (!masterDoorwayEnabled()) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  // Logout: clear the master cookie and return to the login screen.
  if (request.nextUrl.searchParams.get("logout") === "1") {
    const response = NextResponse.redirect(new URL("/master", request.url), 303);
    response.cookies.set(MASTER_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }

  const ip = clientIp(request);
  const entry = failures.get(ip);
  if (entry && entry.lockedUntil > Date.now()) {
    return new NextResponse("Prea multe încercări. Revino în 15 minute.", {
      status: 429,
      headers: { "retry-after": String(Math.ceil((entry.lockedUntil - Date.now()) / 1000)) },
    });
  }

  const form = await request.formData();
  const user = String(form.get("user") ?? "");
  const pass = String(form.get("pass") ?? "");

  if (!checkMasterCredentials(user, pass)) {
    const count = (entry?.count ?? 0) + 1;
    failures.set(ip, {
      count,
      lockedUntil: count >= FAIL_LIMIT ? Date.now() + LOCKOUT_MS : 0,
    });
    return NextResponse.redirect(new URL("/master?e=1", request.url), 303);
  }
  failures.delete(ip);

  const value = masterCookieValue();
  if (!value) {
    // Should be unreachable when creds check passed, but stay closed if not.
    return NextResponse.redirect(new URL("/master?e=1", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/master", request.url), 303);
  response.cookies.set(MASTER_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
    // Cookie-ul E autorizarea /master pe un an — nu are voie să circule
    // pe HTTP simplu în producție (armata 2026-08-14).
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
