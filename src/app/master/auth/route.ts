import { NextResponse, type NextRequest } from "next/server";
import {
  MASTER_COOKIE,
  checkMasterCredentials,
  masterCookieValue,
  masterDoorwayEnabled,
} from "@/lib/master/gate";

const ONE_YEAR = 60 * 60 * 24 * 365;

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

  const form = await request.formData();
  const user = String(form.get("user") ?? "");
  const pass = String(form.get("pass") ?? "");

  if (!checkMasterCredentials(user, pass)) {
    return NextResponse.redirect(new URL("/master?e=1", request.url), 303);
  }

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
  });
  return response;
}
