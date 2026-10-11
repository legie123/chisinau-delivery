import { isSoldOut } from "@chisinau/shared-domain";
import type { Restaurant } from "../types";

// Pure browse rules for Home + Search — the same filter/sort/rails as the web
// RestaurantBrowser. No React Native imports: tested in tests/browse.test.ts.

export type SortKey = "recommended" | "distance" | "rating";
export type CategoryKey = "all" | "sushi" | "fine_dining" | "catering";

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "recommended", label: "Recomandate" },
  { key: "distance", label: "Distanță" },
  { key: "rating", label: "Rating" },
];

export const BROWSE_CATEGORIES: { key: CategoryKey; label: string; emoji: string }[] = [
  { key: "all", label: "Toate", emoji: "🔥" },
  { key: "sushi", label: "Sushi", emoji: "🍣" },
  { key: "fine_dining", label: "Fine Dining", emoji: "🥂" },
  { key: "catering", label: "Catering", emoji: "🎉" },
];

export type BrowseFilter = { query: string; category: CategoryKey; openNowOnly: boolean; sort: SortKey };
export const DEFAULT_FILTER: BrowseFilter = { query: "", category: "all", openNowOnly: false, sort: "recommended" };

/** Can take an order right now: today's hours AND the partner's manual switch. */
export function isOpenForOrders(r: Restaurant): boolean {
  return r.openNow && r.acceptingOrders;
}

export function isDefaultFilter(f: BrowseFilter): boolean {
  return f.query.trim() === "" && f.category === "all" && !f.openNowOnly;
}

export function filterRestaurants(list: Restaurant[], f: BrowseFilter): Restaurant[] {
  const q = f.query.trim().toLowerCase();
  const kept = list.filter((r) => {
    if (f.openNowOnly && !isOpenForOrders(r)) return false;
    if (f.category === "catering" && !r.acceptsCatering) return false;
    if (f.category !== "all" && f.category !== "catering" && r.cuisine !== f.category) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.category.toLowerCase().includes(q)) return false;
    return true;
  });
  return sortRestaurants(kept, f.sort);
}

export function sortRestaurants(list: Restaurant[], sort: SortKey): Restaurant[] {
  if (sort === "distance") {
    return [...list].sort((a, b) => {
      if (a.distanceM == null && b.distanceM == null) return 0;
      if (a.distanceM == null) return 1;
      if (b.distanceM == null) return -1;
      return a.distanceM - b.distanceM;
    });
  }
  if (sort === "rating") {
    return [...list].sort((a, b) => Number(b.ratingAvg ?? 0) - Number(a.ratingAvg ?? 0) || b.ratingCount - a.ratingCount);
  }
  return list; // "Recomandate" keeps the fetch order (distance when located, else alphabetical).
}

/** "Populare" rail: top-rated, needs >= 3 reviews so a lone 5-star doesn't lead (web rule). */
export function popularRestaurants(list: Restaurant[], max = 8): Restaurant[] {
  return list
    .filter((r) => r.ratingCount >= 3 && r.ratingAvg != null)
    .sort((a, b) => Number(b.ratingAvg) - Number(a.ratingAvg) || b.ratingCount - a.ratingCount)
    .slice(0, max);
}

/** Refetch on focus only when the list is older than this — open-now is minute-sensitive. */
export const STALE_AFTER_MS = 60_000;
export function isStale(loadedAt: number | null, now: number): boolean {
  return loadedAt == null || now - loadedAt >= STALE_AFTER_MS;
}

// ---- "Epuizat" (menu_items.sold_out_until, set from the kitchen tablet) ----
// Same rule as place_order (20261012000102): sold out while sold_out_until is later than now.
// PostgREST returns the "until switched back" value as the string "infinity".

export { isSoldOut };

/** A cart line whose dish is sold out reconciles as unavailable: the cart names it and blocks
 *  the order button, instead of place_order refusing at the last tap. */
export function liveAvailability<T extends { is_available: boolean; sold_out_until: string | null }>(
  row: T,
  now = Date.now(),
): Omit<T, "sold_out_until"> {
  const { sold_out_until, ...rest } = row;
  return { ...rest, is_available: row.is_available && !isSoldOut(sold_out_until, now) };
}
