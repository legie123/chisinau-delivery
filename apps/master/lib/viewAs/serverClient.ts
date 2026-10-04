import { cookies } from "next/headers";
// Relative imports on purpose: "@/lib/supabase/server" itself is aliased to THIS file
// (turbopack.resolveAlias in apps/master/next.config.ts), so it would import itself.
import { createClient as createSessionClient } from "../../../../src/lib/supabase/server";
import { createViewerClient } from "../../../../src/lib/supabase/viewer";
import { VIEW_AS_COOKIE, readViewerToken } from "../../../../src/lib/viewAs/token";

/**
 * createClient() for EVERY server module compiled into the master shell — the monolith pages,
 * layouts, Server Actions and src/lib/auth/require.ts all import "@/lib/supabase/server", and in
 * this app that resolves here. The `view_as` cookie has Path=/view, so the browser sends it only
 * on /view/* requests (pages, their Server Actions, RSC fetches): there the monolith code gets the
 * read-only viewer client; on every other path the admin's own session, exactly as before.
 * Pages covered: everything mirrored under apps/master/app/view (see src/lib/viewAs/paths.ts).
 */
export async function createClient() {
  const token = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (!token) return createSessionClient();
  // Fail closed: a dead or forged view never falls back to the admin's session.
  if (!readViewerToken(token)) {
    throw new Error("Sesiunea de vizualizare a expirat. Pornește-o din nou din /platform/view-as.");
  }
  return createViewerClient(token);
}
