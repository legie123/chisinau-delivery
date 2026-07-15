import { supabase } from "./supabase";
import type { MenuItem, Restaurant } from "../types";

const CUISINE_LABEL: Record<string, string> = {
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
