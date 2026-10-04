import {
  getPopularHours,
  getPrepEstimates,
  getRatingBreakdown,
  nearbyRestaurants,
  searchMenuItems,
  RpcError,
} from "@chisinau/shared-api";
import { chisinauNow, formatPrepRange, isOpenNow, nextOpeningLabel, type HoursRow } from "@chisinau/shared-domain";
import { supabase } from "./supabase";
import type { MenuItem, OptionGroup, Restaurant } from "../types";

// Reads for the customer app. Every RPC goes through @chisinau/shared-api (the same
// typed call-site the web uses); plain table reads are RLS-scoped selects.

export const CUISINE_LABEL: Record<string, string> = {
  sushi: "Sushi · Japonez",
  fine_dining: "Fine Dining",
  other: "Restaurant",
};

export const VENUE_LABEL: Record<string, string> = {
  business_lounge: "Sală de business",
  spa: "Spa",
  wellness_lounge: "Lounge wellness",
  sushi_bar: "Sushi bar",
  restaurant: "Restaurant",
};

/** Message for the user from any thrown error (RpcError carries the Romanian one). */
export function errorText(err: unknown, fallback: string): string {
  return err instanceof RpcError ? err.userMessage : fallback;
}

type RestaurantRow = {
  id: string; slug: string; name: string; cuisine_type: string; venue_type: string; address: string;
  lat: number | null; lng: number | null; logo_url: string | null; cover_photo_url: string | null;
  rating_avg: number | null; rating_count: number; avg_prep_minutes: number; delivery_fee_mdl: number;
  min_order_amount_mdl: number; accepting_orders: boolean; accepts_catering: boolean; catering_min_amount_mdl: number | null;
};

const RESTAURANT_COLS =
  "id, slug, name, cuisine_type, venue_type, address, lat, lng, logo_url, cover_photo_url, rating_avg, rating_count, avg_prep_minutes, delivery_fee_mdl, min_order_amount_mdl, accepting_orders, accepts_catering, catering_min_amount_mdl";

/** Restaurants that DELIVER (spa/lounges are booked, not ordered — same as the web list).
 *  With a position, nearby_restaurants sorts them by distance (fail-open to alphabetical). */
export async function fetchRestaurants(position?: { lat: number; lng: number } | null): Promise<Restaurant[]> {
  const [{ data, error }, { data: hours }, nearby] = await Promise.all([
    supabase.from("restaurants").select(RESTAURANT_COLS).eq("is_active", true).in("venue_type", ["restaurant", "sushi_bar"]).order("name"),
    supabase.from("restaurant_hours").select("restaurant_id, day_of_week, opens_at, closes_at, is_closed"),
    position ? nearbyRestaurants(supabase, position.lat, position.lng, 15, 50) : Promise.resolve([]),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as RestaurantRow[];
  const estimates = await getPrepEstimates(supabase, rows.map((r) => r.id));
  const byId = new Map(estimates.map((e) => [e.restaurant_id, e]));
  const distance = new Map(nearby.map((n) => [n.id, n.distance_m]));
  const hoursBy = new Map<string, HoursRow[]>();
  for (const h of (hours ?? []) as HoursRow[]) hoursBy.set(h.restaurant_id, [...(hoursBy.get(h.restaurant_id) ?? []), h]);
  const { dow, time } = chisinauNow();

  const list = rows.map((r) => toRestaurant(r, byId.get(r.id), hoursBy.get(r.id), distance.get(r.id) ?? null, dow, time));
  if (distance.size === 0) return list;
  return list.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
}

function toRestaurant(
  r: RestaurantRow,
  estimate: { prep_minutes: number; p90_prep_minutes: number | null } | undefined,
  hours: HoursRow[] | undefined,
  distanceM: number | null,
  dow: number,
  time: string,
): Restaurant {
  // No hours rows at all = no schedule configured; place_order is then the judge.
  const openNow = !hours || hours.length === 0 ? true : isOpenNow(hours, dow, time);
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    cuisine: r.cuisine_type,
    venueType: r.venue_type,
    category: CUISINE_LABEL[r.cuisine_type] ?? VENUE_LABEL[r.venue_type] ?? "Restaurant",
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    logoUrl: r.logo_url,
    coverUrl: r.cover_photo_url,
    ratingAvg: r.rating_avg,
    ratingCount: r.rating_count,
    prepLabel: formatPrepRange(estimate ?? r.avg_prep_minutes),
    deliveryFee: Number(r.delivery_fee_mdl),
    minOrder: Number(r.min_order_amount_mdl),
    acceptingOrders: r.accepting_orders,
    openNow,
    nextOpening: openNow || !hours ? null : nextOpeningLabel(hours, dow, time),
    distanceM,
    acceptsCatering: r.accepts_catering,
    cateringMin: r.catering_min_amount_mdl,
  };
}

export async function fetchMenu(
  restaurantId: string,
  opts: { catering?: boolean } = {},
): Promise<{ items: MenuItem[]; categories: string[]; groups: Record<string, OptionGroup[]> }> {
  let itemsQuery = supabase
    .from("menu_items")
    .select("id, restaurant_id, name, description, price_mdl, photo_url, category_id, catering_min_qty")
    .eq("restaurant_id", restaurantId)
    .eq("is_available", true);
  if (!opts.catering) itemsQuery = itemsQuery.eq("is_catering_only", false);
  const [{ data: items, error }, { data: cats }] = await Promise.all([
    itemsQuery.order("sort_order"),
    supabase.from("menu_categories").select("id, name").eq("restaurant_id", restaurantId).order("sort_order"),
  ]);
  if (error) throw new Error(error.message);
  const catName = new Map((cats ?? []).map((c) => [c.id, c.name]));
  const mapped: MenuItem[] = (items ?? []).map((i) => ({
    id: i.id,
    restaurantId: i.restaurant_id,
    name: i.name,
    description: i.description ?? "",
    priceMdl: Number(i.price_mdl),
    imageUrl: i.photo_url,
    category: (i.category_id && catName.get(i.category_id)) || "Meniu",
    cateringMinQty: i.catering_min_qty,
  }));

  const groups: Record<string, OptionGroup[]> = {};
  if (mapped.length > 0 && !opts.catering) {
    const { data: rawGroups, error: groupsError } = await supabase
      .from("menu_option_groups")
      .select("id, menu_item_id, name, is_required, min_select, max_select, menu_options(id, name, price_delta_mdl, is_available, sort_order)")
      .in("menu_item_id", mapped.map((i) => i.id))
      .order("sort_order")
      .order("sort_order", { referencedTable: "menu_options" });
    // Without the groups a required-option item can't be ordered correctly — fail
    // loudly rather than let place_order reject the whole cart later.
    if (groupsError) throw new Error(groupsError.message);
    for (const g of rawGroups ?? []) {
      (groups[g.menu_item_id] ??= []).push({
        id: g.id,
        menuItemId: g.menu_item_id,
        name: g.name,
        is_required: g.is_required,
        min_select: g.min_select,
        max_select: g.max_select,
        options: (g.menu_options ?? []).filter((o) => o.is_available).map((o) => ({ ...o, price_delta_mdl: Number(o.price_delta_mdl) })),
      });
    }
  }
  return { items: mapped, categories: [...new Set(mapped.map((i) => i.category))], groups };
}

export async function fetchInsights(restaurantId: string) {
  const [hours, breakdown] = await Promise.all([getPopularHours(supabase, restaurantId), getRatingBreakdown(supabase, restaurantId)]);
  return { hours, breakdown };
}

export async function searchDishes(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return searchMenuItems(supabase, trimmed);
}

// ---------- Auth ----------

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function signUp(email: string, password: string, fullName: string): Promise<string | null> {
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, role: "customer" } },
  });
  return error ? error.message : null;
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function isSignedIn(): Promise<boolean> {
  return (await currentUserId()) !== null;
}

// ---------- Profile ----------

export interface CustomerProfile {
  fullName: string;
  phone: string | null;
  email: string | null;
  orderCount: number;
  favoriteCount: number;
}

export async function fetchMyProfile(): Promise<CustomerProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: profile, error }, { count: orderCount }, { count: favoriteCount }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).single(),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", user.id),
    supabase.from("favorites").select("customer_id", { count: "exact", head: true }).eq("customer_id", user.id),
  ]);
  if (error) throw new Error(error.message);
  return {
    fullName: profile?.full_name || user.email || "Client",
    phone: profile?.phone ?? null,
    email: user.email ?? null,
    orderCount: orderCount ?? 0,
    favoriteCount: favoriteCount ?? 0,
  };
}

// ---------- Addresses ----------

export type SavedAddress = { id: string; street_address: string; contact_phone: string | null; notes: string | null };

export async function fetchMyAddresses(): Promise<SavedAddress[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("addresses")
    .select("id, street_address, contact_phone, notes")
    .eq("customer_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createAddress(input: {
  street_address: string;
  contact_phone: string;
  notes?: string;
  lat?: number;
  lng?: number;
}): Promise<string> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Trebuie să fii autentificat.");
  const { data, error } = await supabase
    .from("addresses")
    .insert({ customer_id: userId, ...input, notes: input.notes || null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

// ---------- Orders ----------

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  orderType: string;
  restaurantName: string;
  totalMdl: number;
  createdAt: string;
}

export async function fetchMyOrders(): Promise<CustomerOrder[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, status, order_type, total_mdl, created_at, restaurants(name)")
    .eq("customer_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    orderType: o.order_type,
    restaurantName: (o.restaurants as { name: string } | null)?.name ?? "",
    totalMdl: Number(o.total_mdl),
    createdAt: o.created_at,
  }));
}

// ---------- Catering + concierge ----------

export type CateringRestaurant = { id: string; name: string; cateringMin: number | null };

export async function fetchCateringRestaurants(): Promise<CateringRestaurant[]> {
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, name, catering_min_amount_mdl")
    .eq("is_active", true)
    .eq("accepts_catering", true)
    .eq("accepting_orders", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, cateringMin: r.catering_min_amount_mdl }));
}

export type Venue = { id: string; name: string; venueType: string; sector: string | null; description: string | null; coverUrl: string | null };

/** Every active venue is bookable (spa/lounge/business AND restaurants for a table). */
export async function fetchVenues(): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, name, venue_type, sector, description, cover_photo_url")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((v) => v.venue_type in VENUE_LABEL)
    .map((v) => ({ id: v.id, name: v.name, venueType: v.venue_type, sector: v.sector, description: v.description, coverUrl: v.cover_photo_url }));
}

export type Booking = {
  id: string; startsAt: string; endsAt: string; partySize: number; purpose: string; status: string;
  quotedPriceMdl: number | null; declineReason: string | null; venueName: string;
};

/** RLS (venue_bookings_customer_read) returns only the caller's rows. */
export async function fetchMyBookings(): Promise<Booking[]> {
  if (!(await isSignedIn())) return [];
  const { data, error } = await supabase
    .from("venue_bookings")
    .select("id, starts_at, ends_at, party_size, purpose, status, quoted_price_mdl, decline_reason, restaurants(name)")
    .order("starts_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    id: b.id,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    partySize: b.party_size,
    purpose: b.purpose,
    status: b.status,
    quotedPriceMdl: b.quoted_price_mdl,
    declineReason: b.decline_reason,
    venueName: (b.restaurants as { name: string } | null)?.name ?? "",
  }));
}
