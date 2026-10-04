import type { ViewAsApp } from "@/lib/viewAs/token";

// Which monolith pages a view-as session shows, inside the master shell under /view + the
// monolith path (/view/orders, /view/deliveries, /view/restaurant/orders …). Monolith paths of
// the three surfaces never collide, so no role segment is needed — the role is in the token.
// Read pages only: the cart/checkout flows and the other roles' surfaces stay out.
export const VIEW_PREFIX = "/view";

export const VIEW_PATHS: Record<ViewAsApp, string[]> = {
  client: ["/orders", "/restaurants", "/catering", "/concierge/rezervari"],
  curier: ["/deliveries", "/earnings"],
  restaurant: [
    "/restaurant/orders",
    "/restaurant/rezervari",
    "/restaurant/menu",
    "/restaurant/hours",
    "/restaurant/catering",
    "/restaurant/earnings",
    "/restaurant/analytics",
  ],
};

export const VIEW_HOME: Record<ViewAsApp, string> = {
  client: "/orders",
  curier: "/deliveries",
  restaurant: "/restaurant/orders",
};

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** A monolith path ("/orders/1", "/" = the surface's home) as seen inside the view, or null if
 *  the view does not show it. */
export function toViewPath(app: ViewAsApp, monolithPath: string): string | null {
  const path = monolithPath === "/" ? VIEW_HOME[app] : monolithPath;
  return VIEW_PATHS[app].some((p) => under(path, p)) ? VIEW_PREFIX + path : null;
}

/** "/view/orders/1" → "/orders/1" when the app's view shows it; otherwise null. */
export function fromViewPath(app: ViewAsApp, pathname: string): string | null {
  if (!under(pathname, VIEW_PREFIX)) return null;
  const path = pathname.slice(VIEW_PREFIX.length) || "/";
  return toViewPath(app, path) ? (path === "/" ? VIEW_HOME[app] : path) : null;
}
