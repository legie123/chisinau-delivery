"use server";

import { revalidatePath } from "next/cache";
import { requireOwnRestaurant } from "@/lib/auth/require";

export type ActionState = { error: string | null };

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Numele categoriei este obligatoriu." };

    const { error } = await supabase.from("menu_categories").insert({ restaurant_id: restaurantId, name });
    if (error) return { error: error.message };

    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function deleteCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await requireOwnRestaurant();
    const categoryId = String(formData.get("category_id") ?? "");

    const { error } = await supabase.from("menu_categories").delete().eq("id", categoryId);
    if (error) return { error: error.message };

    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function createMenuItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();

    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const priceMdl = Number(formData.get("price_mdl") ?? 0);
    const categoryId = String(formData.get("category_id") ?? "") || null;
    const photoUrl = String(formData.get("photo_url") ?? "").trim() || null;
    const isCateringOnly = formData.get("is_catering_only") === "on";

    if (!name || priceMdl <= 0) return { error: "Nume și preț valid sunt obligatorii." };

    const { error } = await supabase.from("menu_items").insert({
      restaurant_id: restaurantId,
      category_id: categoryId,
      name,
      description,
      price_mdl: priceMdl,
      photo_url: photoUrl,
      is_catering_only: isCateringOnly,
    });
    if (error) return { error: error.message };

    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function toggleItemAvailability(itemId: string, isAvailable: boolean): Promise<ActionState> {
  try {
    const { supabase } = await requireOwnRestaurant();
    const { error } = await supabase.from("menu_items").update({ is_available: isAvailable }).eq("id", itemId);
    if (error) return { error: error.message };
    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function deleteMenuItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await requireOwnRestaurant();
    const itemId = String(formData.get("item_id") ?? "");

    const { error } = await supabase.from("menu_items").delete().eq("id", itemId);
    if (error) return { error: error.message };

    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
