import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session on every request and returns the verified
// user (via getUser(), never getSession() — see @supabase/ssr README on why
// getSession() must not be used for authorization decisions).
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, val]) => response.headers.set(key, val));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user, supabase };
}

export async function fetchRole(supabase: Awaited<ReturnType<typeof updateSession>>["supabase"], userId: string) {
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
  return profile?.role ?? null;
}

export function redirectWithSessionCookies(request: NextRequest, sessionResponse: NextResponse, to: URL) {
  const redirectResponse = NextResponse.redirect(to);
  sessionResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
  return redirectResponse;
}
