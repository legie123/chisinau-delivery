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
