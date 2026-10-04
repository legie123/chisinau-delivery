// Relative imports on purpose: "@/lib/supabase/client" itself is aliased to THIS file
// (turbopack.resolveAlias in apps/master/next.config.ts), so it would import itself.
import { createClient as createSessionClient } from "../../../../src/lib/supabase/client";
import { createViewerBrowserClient } from "../../../../src/lib/supabase/viewer";
import { VIEW_PREFIX } from "../../../../src/lib/viewAs/paths";

declare global {
  interface Window {
    __VIEW_AS_TOKEN__?: string;
  }
}

let viewer: { token: string; client: ReturnType<typeof createViewerBrowserClient> } | null = null;

/**
 * Browser createClient() for every client component compiled into the master shell
 * (FavoriteButton, CancelOrderButton, realtime hooks, AuthListener …). On a /view page it is the
 * viewer client — so a write from the browser goes out as role `viewer` and the DATABASE refuses
 * it — never the admin's own session. The token is put on window by the view layout (ViewAsChrome)
 * before any child renders; without it this throws instead of falling back to the admin.
 */
export function createClient() {
  const path = typeof window === "undefined" ? null : window.location.pathname;
  if (path === VIEW_PREFIX || path?.startsWith(`${VIEW_PREFIX}/`)) {
    const token = window.__VIEW_AS_TOKEN__;
    if (!token) throw new Error("Mod vizualizare: sesiunea nu e încărcată.");
    if (viewer?.token !== token) viewer = { token, client: createViewerBrowserClient(token) };
    return viewer.client;
  }
  return createSessionClient();
}
