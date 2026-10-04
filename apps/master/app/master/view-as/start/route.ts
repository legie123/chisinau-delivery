import { NextResponse, type NextRequest } from "next/server";
import { mapPgError } from "@chisinau/shared-api";
import { createClient } from "@/lib/supabase/server";
import { VIEW_HOME, VIEW_PREFIX } from "@/lib/viewAs/paths";
import {
  VIEW_AS_APPS,
  VIEW_AS_COOKIE,
  VIEW_AS_TTL_SECONDS,
  signViewerToken,
  viewerSecret,
  type ViewAsApp,
} from "@/lib/viewAs/token";

function backToPicker(request: NextRequest, error: string) {
  const to = new URL("/platform/view-as", request.url);
  to.searchParams.set("e", error);
  return NextResponse.redirect(to, 303);
}

// POST /master/view-as/start — the form on /platform/view-as. The DATABASE decides
// (start_view_as: platform_admin only, the target owns the surface, a reason is given) and writes
// the audit row; only then is the 15-minute viewer token minted, into an httpOnly cookie that the
// browser sends to /view/* only.
export async function POST(request: NextRequest) {
  // Same-origin forms only. The admin's session cookie is SameSite=Lax already; this is the belt.
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse("Origine refuzată.", { status: 403 });
  }

  let secret: string;
  try {
    secret = viewerSecret();
  } catch (error) {
    return backToPicker(request, (error as Error).message);
  }

  const form = await request.formData();
  const target = String(form.get("target") ?? "");
  const app = String(form.get("app") ?? "") as ViewAsApp;
  const reason = String(form.get("reason") ?? "");
  if (!VIEW_AS_APPS.includes(app)) return backToPicker(request, "Suprafață necunoscută.");

  // The admin's own session: /master/* never carries the /view-scoped cookie.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/platform/view-as", request.url), 303);

  const { data: session, error } = await supabase.rpc("start_view_as", {
    p_target: target,
    p_app: app,
    p_reason: reason,
  });
  if (error || !session) {
    // start_view_as raises Romanian messages; PGRST202 = the function is missing (migration not applied).
    const why =
      error?.code === "PGRST202"
        ? "Vizualizarea nu e instalată în baza de date (lipsește migrarea viewer)."
        : error
          ? mapPgError(error)
          : undefined;
    return backToPicker(request, why ?? "Vizualizarea nu a pornit.");
  }

  const token = signViewerToken({ target, admin: user.id, session, app }, secret);
  const response = NextResponse.redirect(new URL(VIEW_PREFIX + VIEW_HOME[app], request.url), 303);
  response.cookies.set(VIEW_AS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: VIEW_PREFIX,
    maxAge: VIEW_AS_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
