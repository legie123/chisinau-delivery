import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;
type Fns = Database["public"]["Functions"];

// Read-only discovery RPCs (browse/search/ETA). They still go through wrappers so
// there is exactly one typed call-site per RPC, shared with Expo.
//
// getPrepEstimates + nearbyRestaurants are non-critical browse enrichments — a
// hiccup must never crash the page, so they SOFT-FAIL to an empty result (matching
// the callers' original `const { data } = ...` that ignored the error). Search
// surfaces its error (the API route turns it into a 500), so it throws.

/** Rolling prep-time estimates (min) for a set of restaurants. Soft-fails to []. */
export async function getPrepEstimates(
  db: Db,
  restaurantIds: string[],
): Promise<Fns["get_prep_estimates"]["Returns"]> {
  const { data, error } = await db.rpc("get_prep_estimates", { p_restaurant_ids: restaurantIds });
  if (error) return [];
  return data ?? [];
}

/** Distance-sorted nearby restaurants for a geolocation + radius. Soft-fails to []. */
export async function nearbyRestaurants(
  db: Db,
  lat: number,
  lng: number,
  radiusKm: number,
  limit: number,
): Promise<Fns["nearby_restaurants"]["Returns"]> {
  const { data, error } = await db.rpc("nearby_restaurants", {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: radiusKm,
    p_limit: limit,
  });
  if (error) return [];
  return data ?? [];
}

/** Cross-restaurant menu-item search. */
export async function searchMenuItems(db: Db, query: string): Promise<Fns["search_menu_items"]["Returns"]> {
  const { data, error } = await db.rpc("search_menu_items", { p_query: query });
  if (error) throw new RpcError(error);
  return data ?? [];
}

// Order 9 — public transparency page (/cum-functioneaza). Both readers are
// SECURITY DEFINER + granted to anon (no account needed) and exclude
// created_by — see migration 20260727002100. Soft-fail to [] like the other
// anon-reachable browse enrichments above: a hiccup on an unauthenticated
// marketing page must never crash it.

/** Published, versioned commission-split history (oldest first). Soft-fails to []. */
export async function getPublicPricingHistory(db: Db): Promise<Fns["public_pricing_history"]["Returns"]> {
  const { data, error } = await db.rpc("public_pricing_history");
  if (error) return [];
  return data ?? [];
}

/** Published, versioned courier tariff history (oldest first). Soft-fails to []. */
export async function getPublicCourierTariffHistory(db: Db): Promise<Fns["public_courier_tariff_history"]["Returns"]> {
  const { data, error } = await db.rpc("public_courier_tariff_history");
  if (error) return [];
  return data ?? [];
}

// ANALYTICS DATA LAYER (migration 20260728000000) — two more anon-reachable,
// aggregate-only SECURITY DEFINER readers for the public restaurant page's
// histograms (Google-"popular times" style + star breakdown). Same soft-fail
// contract as the rest of this file: a chart that fails to load must render
// an elegant empty state, never crash the page.

/** 24 hour-of-day buckets (0-23), last 28d delivered orders, raw count + 0-100
 * intensity normalized against the restaurant's own busiest hour. Soft-fails to []. */
export async function getPopularHours(db: Db, restaurantId: string): Promise<Fns["popular_hours"]["Returns"]> {
  const { data, error } = await db.rpc("popular_hours", { p_restaurant_id: restaurantId });
  if (error) return [];
  return data ?? [];
}

/** 5 star buckets (1-5) + repeated total_ratings, aggregate-only (no PII). Soft-fails to []. */
export async function getRatingBreakdown(db: Db, restaurantId: string): Promise<Fns["rating_breakdown"]["Returns"]> {
  const { data, error } = await db.rpc("rating_breakdown", { p_restaurant_id: restaurantId });
  if (error) return [];
  return data ?? [];
}
