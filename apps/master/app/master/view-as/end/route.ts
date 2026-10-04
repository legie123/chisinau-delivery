import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { VIEW_PREFIX } from "@/lib/viewAs/paths";
import { VIEW_AS_COOKIE } from "@/lib/viewAs/token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /master/view-as/end — the banner's "Ieși din vizualizare". end_view_as() stamps ended_at on
// the audit row (only the admin who started it can), which the viewer RLS checks on every query:
// the token is dead from this moment, not at its exp. The cookie (Path=/view) is cleared too.
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse("Origine refuzată.", { status: 403 });
  }

  const session = String((await request.formData()).get("session") ?? "");
  const to = new URL("/platform/view-as", request.url);
  if (UUID.test(session)) {
    // The admin's own session (no /view cookie on /master/*).
    const supabase = await createClient();
    const { error } = await supabase.rpc("end_view_as", { p_session: session });
    if (error) to.searchParams.set("e", error.message);
  }

  const response = NextResponse.redirect(to, 303);
  response.cookies.set(VIEW_AS_COOKIE, "", { path: VIEW_PREFIX, maxAge: 0 });
  return response;
}
