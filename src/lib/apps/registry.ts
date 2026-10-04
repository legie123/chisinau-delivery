// The four apps (decision 2026-10-03): thin shells over this same src/ tree, one Supabase.
// This file is the single source of truth for WHO OWNS WHICH PATH and WHERE each app lives.
// The monolith (src/app, :3007 dev / :3000 prod) does not import it — nothing dies there.
//
// "Native movement" between apps = a request for a path another app owns is redirected
// to that app's origin with the same path + query. The Supabase auth cookie is scoped to
// the host (localhost), and cookies ignore ports, so the session follows the user across
// :3001-:3004 as long as the HOSTNAME is preserved (localhost vs 127.0.0.1 are different
// cookie jars — never swap one for the other in a redirect).

export type AppId = "client" | "curier" | "restaurant" | "master";

// Client and courier went NATIVE (decision 2026-10-03): no web shell runs on 3001/3002, and on
// this machine :3001 is an unrelated process (obscura MCP) that would receive the Supabase cookie
// (cookies ignore ports) if we redirected there. Their web pages still live in the monolith, so
// client/curier paths go to the monolith's operational dev server (:3007). Production: set
// APP_ORIGIN_CLIENT / APP_ORIGIN_CURIER to the real origin. Verifier finding 2026-10-04.
export const MONOLITH_DEV_PORT = 3007;

export const APP_PORTS: Record<AppId, number> = {
  client: MONOLITH_DEV_PORT,
  curier: MONOLITH_DEV_PORT,
  restaurant: 3003,
  master: 3004,
};

export const APP_HOME: Record<AppId, string> = {
  client: "/",
  curier: "/deliveries",
  restaurant: "/restaurant/orders",
  master: "/platform",
};

// Exact path or path prefix (segment-bounded: "/restaurant" owns "/restaurant/x" but NOT
// "/restaurants"). Order matters only for readability; matching is longest-prefix.
const OWNERSHIP: Array<[string, AppId]> = [
  ["/deliveries", "curier"],
  ["/earnings", "curier"],
  ["/restaurant", "restaurant"],
  ["/platform", "master"],
  ["/master", "master"],
  ["/api/platform", "master"],
  // View-as ("vezi ca"): read-only monolith pages for a viewed user, served by the master shell.
  ["/view", "master"],
];

// Served by EVERY app itself (never redirected): auth, shared API, PWA plumbing, dev doorway.
const SHARED_PREFIXES = ["/login", "/enter", "/api/route", "/api/menu-search", "/sw.js", "/manifest.webmanifest", "/_next", "/icon-", "/brand", "/videos", "/favicon.ico", "/apple-icon.png", "/robots.txt", "/sitemap.xml"];

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

function underAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => (p.endsWith("-") ? pathname.startsWith(p) : underPrefix(pathname, p)));
}

/** Which app owns a path. Everything not claimed by curier/restaurant/master is the client's. */
export function ownerOf(pathname: string): AppId {
  let best: [string, AppId] | null = null;
  for (const entry of OWNERSHIP) {
    if (underPrefix(pathname, entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best ? best[1] : "client";
}

export function isSharedPath(pathname: string): boolean {
  return underAny(pathname, SHARED_PREFIXES);
}

/**
 * Absolute origin of an app, for the SAME hostname the current request came in on.
 * `APP_ORIGIN_<ID>` env wins (production: real domains); locally it is hostname:port.
 */
export function appOrigin(app: AppId, currentHost: string | null, protocol = "http:"): string {
  const fromEnv = process.env[`APP_ORIGIN_${app.toUpperCase()}`];
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const hostname = (currentHost ?? "localhost").replace(/:\d+$/, "") || "localhost";
  return `${protocol}//${hostname}:${APP_PORTS[app]}`;
}

/**
 * The redirect an app's proxy must issue for a path it does not own, or null if it owns it
 * (or the path is shared). Keeps path + search; swaps only the origin.
 */
export function foreignRedirect(
  thisApp: AppId,
  url: { pathname: string; search: string; protocol: string },
  currentHost: string | null,
): string | null {
  if (isSharedPath(url.pathname)) return null;
  const owner = ownerOf(url.pathname);
  if (owner === thisApp) return null;
  return appOrigin(owner, currentHost, url.protocol) + url.pathname + url.search;
}
