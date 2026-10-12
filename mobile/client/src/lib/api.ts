import {
  getPopularHours,
  getPrepEstimates,
  getRatingBreakdown,
  nearbyRestaurants,
  searchMenuItems,
} from "@chisinau/shared-api";
import { chisinauNow, formatPrepRange, isOpenNow, nextOpeningLabel, type HoursRow } from "@chisinau/shared-domain";
import { supabase } from "./supabase";
import { isSoldOut, liveAvailability } from "./browse";
import type { MenuItem, OptionGroup, Restaurant } from "../types";
import type { LiveItem, LiveOption } from "@chisinau/shared-domain";
import type { ReorderGroup, ReorderLiveItem, ReorderSourceItem } from "./reorder";

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

export { errorText } from "./errors";

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
  // Hours embedded per restaurant: a separate whole-table read is cut at PostgREST
  // max_rows (1000), and every restaurant past the cut showed closed.
  const [{ data, error }, nearby] = await Promise.all([
    supabase
      .from("restaurants")
      .select(`${RESTAURANT_COLS}, restaurant_hours(restaurant_id, day_of_week, opens_at, closes_at, is_closed)`)
      .eq("is_active", true)
      .in("venue_type", ["restaurant", "sushi_bar"])
      .order("name"),
    position ? nearbyRestaurants(supabase, position.lat, position.lng, 15, 50) : Promise.resolve([]),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as (RestaurantRow & { restaurant_hours: HoursRow[] })[];
  const estimates = await getPrepEstimates(supabase, rows.map((r) => r.id));
  const byId = new Map(estimates.map((e) => [e.restaurant_id, e]));
  const distance = new Map(nearby.map((n) => [n.id, n.distance_m]));
  const { dow, time } = chisinauNow();

  const zone = await deliveryZone();
  const list = rows.map((r) => ({
    ...toRestaurant(r, byId.get(r.id), r.restaurant_hours, distance.get(r.id) ?? null, dow, time),
    deliversHere: zone ? zone.has(r.id) : null,
  }));
  if (distance.size === 0) return list;
  return list.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
}

/** Restaurants that deliver to the signed-in customer's default PINNED address (the place_order
 *  radius rule, restaurants_delivering_to). null = unknown (signed out, no pinned address, offline):
 *  the list then stays as it was — place_order is still the one that decides. */
async function deliveryZone(): Promise<Set<string> | null> {
  try {
    const book = await fetchAddressBook();
    const home = book.find((a) => a.lat != null && a.lng != null);
    if (!home) return null;
    const { data, error } = await supabase.rpc("restaurants_delivering_to", { p_lat: Number(home.lat), p_lng: Number(home.lng) });
    if (error || !data) return null;
    return new Set(data as string[]);
  } catch {
    return null;
  }
}

export function toRestaurant(
  r: RestaurantRow,
  estimate: { prep_minutes: number; p90_prep_minutes: number | null } | undefined,
  hours: HoursRow[] | undefined,
  distanceM: number | null,
  dow: number,
  time: string,
): Restaurant {
  // No hours rows = closed, exactly like place_order (restaurant_open_at) and the web.
  const openNow = isOpenNow(hours ?? [], dow, time);
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
    nextOpening: openNow ? null : nextOpeningLabel(hours ?? [], dow, time),
    distanceM,
    acceptsCatering: r.accepts_catering,
    cateringMin: r.catering_min_amount_mdl,
    deliversHere: null,
  };
}

export async function fetchMenu(
  restaurantId: string,
  opts: { catering?: boolean } = {},
): Promise<{ items: MenuItem[]; categories: string[]; groups: Record<string, OptionGroup[]> }> {
  let itemsQuery = supabase
    .from("menu_items")
    .select("id, restaurant_id, name, description, price_mdl, photo_url, category_id, catering_min_qty, sold_out_until")
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
    soldOut: isSoldOut(i.sold_out_until),
  }));

  // Catering too: place_order enforces required groups on every order type.
  const groups: Record<string, OptionGroup[]> = {};
  if (mapped.length > 0) {
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

/** Live price/availability of the cart's items and options (cart reconciliation).
 *  null on any read error: offline keeps the cart as it is. */
export async function fetchLiveMenu(itemIds: string[], optionIds: string[]): Promise<{ items: LiveItem[]; options: LiveOption[] } | null> {
  const [{ data: items, error }, { data: options, error: optError }] = await Promise.all([
    supabase.from("menu_items").select("id, price_mdl, is_available, sold_out_until").in("id", itemIds),
    optionIds.length
      ? supabase.from("menu_options").select("id, price_delta_mdl, is_available").in("id", optionIds)
      : Promise.resolve({ data: [] as LiveOption[], error: null }),
  ]);
  if (error || optError || !items) return null;
  return { items: items.map((i) => liveAvailability(i)), options: options ?? [] };
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

/** Empty state "no couriers": is any active courier online right now? (couriers_available, one
 *  boolean, authenticated only). null = unknown (signed out / offline) — then nothing is shown. */
export async function fetchCouriersAvailable(): Promise<boolean | null> {
  if (!(await currentUserId())) return null;
  const { data, error } = await supabase.rpc("couriers_available");
  return error || typeof data !== "boolean" ? null : data;
}

/** In-app account deletion (App Store 5.1.1(v)): delete_my_account() scrubs the personal data,
 *  removes every session server-side and anonymizes the login; orders stay anonymous (fiscal).
 *  Then the local session is dropped. Throws the server's Romanian refusal (order in flight, …). */
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw new Error(error.message);
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
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
  notes?: string | null;
  label?: string | null;
  sector?: string | null;
  building?: string | null;
  apartment?: string | null;
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

// Address book (Profile → Adrese salvate, and the checkout chips). All writes are plain
// RLS-scoped table writes: addresses_owner_write/update/delete all require
// customer_id = auth.uid(), so a phone can only ever touch its own rows.

export type AddressBookEntry = SavedAddress & {
  label: string | null;
  sector: string | null;
  building: string | null;
  apartment: string | null;
  is_default: boolean;
  lat: number | null;
  lng: number | null;
};

/** Default first, then newest — the web checkout's order. */
export async function fetchAddressBook(): Promise<AddressBookEntry[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("addresses")
    .select("id, street_address, contact_phone, notes, label, sector, building, apartment, is_default, lat, lng")
    .eq("customer_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function updateAddress(
  id: string,
  patch: { street_address: string; contact_phone: string; notes: string | null; label: string | null; sector: string | null; building: string | null; apartment: string | null; lat?: number | null; lng?: number | null },
): Promise<void> {
  const { error } = await supabase.from("addresses").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** orders.delivery_address_id has no ON DELETE: an address any order used can't be
 *  deleted (23503) — said in Romanian instead of the raw FK text. */
export async function deleteAddress(id: string): Promise<void> {
  const { error } = await supabase.from("addresses").delete().eq("id", id);
  if (error?.code === "23503") throw new Error("Adresa apare într-o comandă și nu poate fi ștearsă — o poți edita.");
  if (error) throw new Error(error.message);
}

/** Exactly one default: set this one first, then clear the rest (a failure in between
 *  leaves two defaults, which the default-first ordering tolerates — never zero). */
export async function setDefaultAddress(id: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Trebuie să fii autentificat.");
  const { error } = await supabase.from("addresses").update({ is_default: true }).eq("id", id);
  if (error) throw new Error(error.message);
  const { error: clearError } = await supabase.from("addresses").update({ is_default: false }).eq("customer_id", userId).neq("id", id);
  if (clearError) throw new Error(clearError.message);
}

/** Any order (in flight or past) reads its address live — courier, tracking, delivery
 *  fee, history: such a row is never edited in place (checkout addressEditPlan). */
export async function addressUsedByOrder(id: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("delivery_address_id", id);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
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
  restaurantId: string | null;
  requestedFor: string | null;
}

export async function fetchMyOrders(): Promise<CustomerOrder[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, status, order_type, total_mdl, created_at, restaurant_id, requested_for, restaurants(name)")
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
    restaurantId: o.restaurant_id,
    requestedFor: o.requested_for,
  }));
}

/** Everything "Comandă din nou" needs (src/lib/reorder.ts planReorder): the order's
 *  items with their option snapshots, the CURRENT option groups of those items, and
 *  their live availability. Reads only — RLS scopes order_items to the caller's orders. */
export async function fetchReorderSource(orderId: string): Promise<{
  items: ReorderSourceItem[];
  groups: ReorderGroup[];
  live: ReorderLiveItem[];
}> {
  const { data: rows, error } = await supabase
    .from("order_items")
    .select("menu_item_id, item_name_snapshot, unit_price_mdl, quantity, selected_options")
    .eq("order_id", orderId);
  if (error) throw new Error(error.message);
  const items = (rows ?? []) as unknown as ReorderSourceItem[];
  const ids = [...new Set(items.map((i) => i.menu_item_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return { items, groups: [], live: [] };
  const [{ data: groups, error: gError }, { data: live, error: lError }] = await Promise.all([
    supabase.from("menu_option_groups").select("menu_item_id, name, is_required, min_select, menu_options(id, name)").in("menu_item_id", ids),
    supabase.from("menu_items").select("id, is_available").in("id", ids),
  ]);
  if (gError || lError) throw new Error((gError ?? lError)!.message);
  return { items, groups: (groups ?? []) as ReorderGroup[], live: live ?? [] };
}

/** One restaurant as the Restaurant screen expects it (reorder → "adaugă din meniu"). */
export async function fetchRestaurantById(id: string): Promise<Restaurant | null> {
  const { data, error } = await supabase
    .from("restaurants")
    .select(`${RESTAURANT_COLS}, restaurant_hours(restaurant_id, day_of_week, opens_at, closes_at, is_closed)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as RestaurantRow & { restaurant_hours: HoursRow[] };
  const [estimate] = await getPrepEstimates(supabase, [row.id]);
  const { dow, time } = chisinauNow();
  return toRestaurant(row, estimate, row.restaurant_hours, null, dow, time);
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
