import { createHmac, timingSafeEqual } from "node:crypto";

// View-as ("vezi ca") token: an HS256 JWT signed with the PROJECT JWT secret, so PostgREST
// accepts it and switches to the Postgres role `viewer` (read-only by grants — migration
// 20261004000100). Hand-rolled on node:crypto on purpose (no jose/jsonwebtoken): one header,
// one algorithm, nothing to negotiate. Server-only (node:crypto never reaches a client bundle).
//
// Claims, and why each is there:
//   sub              the viewed user — auth.uid() in every RLS policy
//   role "viewer"    PostgREST SET ROLE viewer → no write grant exists for it
//   aud              "authenticated", like a GoTrue token (PostgREST does not check it)
//   session_id       = the view-as session id, which is NEVER an auth.sessions row: GoTrue then
//                    answers 403 session_not_found to every call. Without it GoTrue accepted the
//                    token for PUT /auth/v1/user (measured) — i.e. it could change the user's email.
//   view_as_session  the audit row; RLS (viewer_session_live) refuses a missing/ended/expired one
//   act.sub          the admin (RFC 8693 actor) — the master proxy requires it to be the signed-in user
//   exp              15 minutes

export const VIEW_AS_COOKIE = "view_as";
export const VIEW_AS_TTL_SECONDS = 15 * 60;
export const VIEW_AS_APPS = ["client", "curier", "restaurant"] as const;
export type ViewAsApp = (typeof VIEW_AS_APPS)[number];

export type ViewerClaims = {
  sub: string;
  role: "viewer";
  aud: "authenticated";
  iat: number;
  exp: number;
  session_id: string;
  view_as_session: string;
  view_as_app: ViewAsApp;
  act: { sub: string };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const CLOCK_SKEW_SECONDS = 60;

const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest();

/** The project JWT secret. Locally: `supabase status -o env` → JWT_SECRET (a public default —
 *  rotate it before this ever faces the internet). Never the anon key. */
export function viewerSecret(): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Vizualizarea e dezactivată: lipsește SUPABASE_JWT_SECRET (minim 32 de caractere).");
  }
  return secret;
}

export function signViewerToken(
  input: { target: string; admin: string; session: string; app: ViewAsApp },
  secret: string,
  now = Math.floor(Date.now() / 1000),
): string {
  for (const id of [input.target, input.admin, input.session]) {
    if (!UUID.test(id)) throw new Error("signViewerToken: id invalid");
  }
  const claims: ViewerClaims = {
    sub: input.target,
    role: "viewer",
    aud: "authenticated",
    iat: now,
    exp: now + VIEW_AS_TTL_SECONDS,
    session_id: input.session,
    view_as_session: input.session,
    view_as_app: input.app,
    act: { sub: input.admin },
  };
  const body = `${HEADER}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return `${body}.${sign(body, secret).toString("base64url")}`;
}

/** The cookie's token, verified with the env secret; null when absent, invalid, expired or the
 *  secret is not configured (view-as then simply does not exist). */
export function readViewerToken(token: string | undefined): ViewerClaims | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!token || !secret || secret.length < 32) return null;
  return verifyViewerToken(token, secret);
}

/** Claims of a token WE minted and that is still valid; null for anything else (never throws). */
export function verifyViewerToken(token: string, secret: string, now = Math.floor(Date.now() / 1000)): ViewerClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) return null; // exact header: no alg games
  const expected = sign(`${parts[0]}.${parts[1]}`, secret);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let c: Partial<ViewerClaims>;
  try {
    c = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const ok =
    c.role === "viewer" &&
    c.aud === "authenticated" &&
    typeof c.sub === "string" && UUID.test(c.sub) &&
    typeof c.view_as_session === "string" && UUID.test(c.view_as_session) &&
    c.session_id === c.view_as_session &&
    typeof c.act?.sub === "string" && UUID.test(c.act.sub) &&
    VIEW_AS_APPS.includes(c.view_as_app as ViewAsApp) &&
    typeof c.exp === "number" && c.exp > now &&
    typeof c.iat === "number" && c.iat <= now + CLOCK_SKEW_SECONDS &&
    c.exp - c.iat <= VIEW_AS_TTL_SECONDS;
  return ok ? (c as ViewerClaims) : null;
}
