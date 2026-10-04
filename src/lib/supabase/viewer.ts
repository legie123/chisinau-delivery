import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";

// Supabase clients that act AS the viewed user, READ-ONLY, for the master shell's view-as
// ("vezi ca"). The token is a viewer JWT (src/lib/viewAs/token.ts): PostgREST runs it as the
// Postgres role `viewer`, which has no write grant anywhere (migration 20261004000100).
//
// What the client does with it:
//   * REST/RPC/Realtime carry it as `Authorization: Bearer` (global header + the session below).
//   * auth-js reads its session from a synthetic cookie store holding ONLY this token
//     (`expires_at: null` → it never tries to refresh), never from the admin's real cookies.
//   * Auth never reaches GoTrue: GET /auth/v1/user is answered here from the token's claims
//     (GoTrue refuses the token anyway — session_id is not a real session), and every other
//     /auth/v1 call (update user, logout, refresh) gets 403 locally.
// The monolith never imports this file; src/lib/supabase/server.ts is unchanged.

const STORAGE_KEY = "sb-view-as-auth-token";
export const VIEWER_CLIENT = Symbol.for("chisinau.viewAs.client");

type Claims = { sub: string; exp: number; iat: number; act?: { sub: string } };

// Decode only — the token was verified (HMAC, exp) server-side before it got here.
function claimsOf(token: string): Claims {
  const b64 = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)))) as Claims;
}

function viewedUser(c: Claims): User {
  return {
    id: c.sub,
    aud: "authenticated",
    role: "viewer",
    app_metadata: { view_as: true, viewed_by: c.act?.sub },
    user_metadata: {},
    created_at: new Date(c.iat * 1000).toISOString(),
  } as User;
}

/** fetch for the viewer client: auth answered locally, everything else passed through. */
export function viewerFetch(token: string, base: typeof fetch = fetch): typeof fetch {
  const user = viewedUser(claimsOf(token));
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.includes("/auth/v1/")) {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "GET" && url.pathname.endsWith("/auth/v1/user")) {
        return Response.json(user);
      }
      return Response.json(
        { code: 403, error_code: "view_as_read_only", msg: "Mod vizualizare: contul nu poate fi modificat." },
        { status: 403 },
      );
    }
    return base(input, init);
  };
}

function viewerOptions(token: string) {
  const claims = claimsOf(token);
  const session = JSON.stringify({
    access_token: token,
    refresh_token: "",
    token_type: "bearer",
    expires_in: Math.max(0, claims.exp - Math.floor(Date.now() / 1000)),
    expires_at: null, // present but null: auth-js treats the session as fresh and never refreshes it
    user: viewedUser(claims),
  });
  return {
    cookieOptions: { name: STORAGE_KEY },
    cookies: {
      getAll: () => [{ name: STORAGE_KEY, value: session }],
      setAll: () => {},
    },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: viewerFetch(token) },
  };
}

function mark<T extends object>(client: T): T {
  Object.defineProperty(client, VIEWER_CLIENT, { value: true });
  return client;
}

/** Server-side client (Server Components, Server Actions, Route Handlers) of the master shell. */
export function createViewerClient(token: string) {
  return mark(
    createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      viewerOptions(token),
    ),
  );
}

/** Browser client for the same view (not the shared singleton — the admin's own stays intact). */
export function createViewerBrowserClient(token: string) {
  return mark(
    createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      ...viewerOptions(token),
      isSingleton: false,
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
    }),
  );
}

export function isViewerClient(client: object): boolean {
  return (client as Record<symbol, unknown>)[VIEWER_CLIENT] === true;
}
