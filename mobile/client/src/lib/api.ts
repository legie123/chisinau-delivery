import { supabase } from "./supabase";
import type { MenuItem, Restaurant } from "../types";

export const CUISINE_LABEL: Record<string, string> = {
  sushi: "Sushi · Japonez",
  fine_dining: "Fine Dining",
  other: "Restaurant",
};

// Maps backend rows (supabase/migrations schema) into the UI types the
// screens already render — the screens stay untouched by schema details.
export async function fetchRestaurants(): Promise<Restaurant[]> {
  const { data, error } = await supabase
    .from("restaurants")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    cuisine: r.cuisine_type as string,
    name: r.name,
    address: r.address,
    lat: "0",
    lng: "0",
    phone: r.phone,
    logoUrl: r.logo_url,
    coverUrl: r.cover_photo_url,
    category: CUISINE_LABEL[r.cuisine_type] ?? r.cuisine_type,
    rating: "Nou",
    deliveryTime: `${r.avg_prep_minutes}-${r.avg_prep_minutes + 15} min`,
    deliveryFee: String(r.delivery_fee_mdl),
    isOpen: r.accepting_orders ? 1 : 0,
    createdAt: Date.parse(r.created_at),
  }));
}

export async function fetchMenu(restaurantId: string): Promise<{ items: MenuItem[]; categories: string[] }> {
  const [{ data: items, error: itemsError }, { data: cats, error: catsError }] = await Promise.all([
    supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("is_available", true)
      .eq("is_catering_only", false)
      .order("sort_order"),
    supabase.from("menu_categories").select("id, name").eq("restaurant_id", restaurantId).order("sort_order"),
  ]);
  if (itemsError) throw new Error(itemsError.message);
  if (catsError) throw new Error(catsError.message);

  const categoryName = new Map((cats ?? []).map((c) => [c.id, c.name]));

  const mapped: MenuItem[] = (items ?? []).map((i) => ({
    id: i.id,
    restaurantId: i.restaurant_id,
    name: i.name,
    description: i.description ?? "",
    price: String(i.price_mdl),
    imageUrl: i.photo_url,
    category: categoryName.get(i.category_id) ?? "Meniu",
    isAvailable: i.is_available ? 1 : 0,
    createdAt: Date.parse(i.created_at),
  }));

  const categories = [...new Set(mapped.map((i) => i.category))];
  return { items: mapped, categories };
}

// ---------- Search ----------

export interface DishSearchResult {
  itemId: string;
  itemName: string;
  itemDescription: string;
  priceMdl: string;
  photoUrl: string | null;
  restaurantId: string;
  restaurantName: string;
  cuisineType: string;
}

// Cross-restaurant dish search via the search_menu_items RPC (anon-safe,
// server-side — see supabase/migrations/20260725000000_search_menu_items.sql).
// The RPC itself requires length(trim(query)) >= 2, so short queries short-circuit here.
export async function searchMenuItems(query: string): Promise<DishSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const { data, error } = await supabase.rpc("search_menu_items", { p_query: trimmed });
  if (error) throw new Error(error.message);

  return (data ?? []).map((d: any) => ({
    itemId: d.item_id,
    itemName: d.item_name,
    itemDescription: d.item_description ?? "",
    priceMdl: String(d.price_mdl),
    photoUrl: d.photo_url,
    restaurantId: d.restaurant_id,
    restaurantName: d.restaurant_name,
    cuisineType: d.cuisine_type,
  }));
}

// ---------- Auth + ordering (customer) ----------

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

export async function isSignedIn(): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return !!session;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// ---------- Profile ----------

export interface CustomerProfile {
  fullName: string;
  phone: string | null;
  email: string | null;
  orderCount: number;
  favoriteCount: number;
}

// Returns null when there is no active session — screens use that to show
// the sign-in prompt instead of a profile.
export async function fetchMyProfile(): Promise<CustomerProfile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile, error: profileError }, { count: orderCount }, { count: favoriteCount }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).single(),
    supabase.from("orders").select("id", { count: "exact", head: true }),
    supabase.from("favorites").select("customer_id", { count: "exact", head: true }),
  ]);
  if (profileError) throw new Error(profileError.message);

  return {
    fullName: profile?.full_name ?? "Client Dragons",
    phone: profile?.phone ?? null,
    email: user.email ?? null,
    orderCount: orderCount ?? 0,
    favoriteCount: favoriteCount ?? 0,
  };
}

export interface PlaceOrderInput {
  restaurantId: string;
  items: { menuItemId: string; quantity: number }[];
  streetAddress: string;
  notes: string;
}

// Creates the address then places the order through the place_order RPC —
// the same validated path the web checkout uses.
export async function placeOrder(input: PlaceOrderInput): Promise<{ orderNumber: string | null; error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { orderNumber: null, error: "Trebuie să fii autentificat." };

  const { data: address, error: addressError } = await supabase
    .from("addresses")
    .insert({ customer_id: user.id, street_address: input.streetAddress, notes: input.notes || null })
    .select("id")
    .single();
  if (addressError) return { orderNumber: null, error: addressError.message };

  const { data: orderId, error: rpcError } = await supabase.rpc("place_order", {
    p_restaurant_id: input.restaurantId,
    p_order_type: "standard",
    p_payment_method: "cash",
    p_items: input.items.map((i) => ({ menu_item_id: i.menuItemId, quantity: i.quantity })),
    p_delivery_address_id: address.id,
    p_notes: input.notes || null,
  });
  if (rpcError) return { orderNumber: null, error: rpcError.message };

  const { data: order } = await supabase.from("orders").select("order_number").eq("id", orderId).single();
  return { orderNumber: order?.order_number ?? "—", error: null };
}

const ORDER_STATUS_RO: Record<string, string> = {
  pending_restaurant: "În așteptare",
  accepted: "Acceptată",
  ready_for_pickup: "Gata de ridicare",
  courier_assigned: "Curier atribuit",
  picked_up: "Ridicată",
  en_route: "Pe drum",
  delivered: "Livrată",
  cancelled: "Anulată",
  rejected: "Refuzată",
};

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  statusLabel: string;
  total: string;
  createdAt: string;
}

export async function fetchMyOrders(): Promise<CustomerOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, status, total_mdl, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    statusLabel: ORDER_STATUS_RO[o.status] ?? o.status,
    total: `${o.total_mdl} MDL`,
    createdAt: new Date(o.created_at).toLocaleString("ro-RO"),
  }));
}
