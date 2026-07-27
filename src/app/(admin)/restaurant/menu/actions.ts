"use server";

import { revalidatePath } from "next/cache";
import { requireOwnRestaurant } from "@/lib/auth/require";

export type ActionState = { error: string | null };

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Numele categoriei este obligatoriu." };

    // #41 — sort_order was never written; new categories always sorted first.
    const { data: maxRow } = await supabase
      .from("menu_categories")
      .select("sort_order")
      .eq("restaurant_id", restaurantId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = (maxRow?.sort_order ?? 0) + 1;

    const { error } = await supabase
      .from("menu_categories")
      .insert({ restaurant_id: restaurantId, name, sort_order: sortOrder });
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
    if (!photoUrl) return { error: "Fotografie obligatorie: preparatul întreg, centrat, clar, fără colaj/text/persoane." };

    // #41 — sort_order was never written; scope the running max to the same
    // restaurant + category so a new item lands after the existing ones there.
    let maxQuery = supabase
      .from("menu_items")
      .select("sort_order")
      .eq("restaurant_id", restaurantId)
      .order("sort_order", { ascending: false })
      .limit(1);
    maxQuery = categoryId ? maxQuery.eq("category_id", categoryId) : maxQuery.is("category_id", null);
    const { data: maxRow } = await maxQuery.maybeSingle();
    const sortOrder = (maxRow?.sort_order ?? 0) + 1;

    const { error } = await supabase.from("menu_items").insert({
      restaurant_id: restaurantId,
      category_id: categoryId,
      name,
      description,
      price_mdl: priceMdl,
      photo_url: photoUrl,
      is_catering_only: isCateringOnly,
      sort_order: sortOrder,
    });
    if (error) return { error: error.message };

    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function updateMenuItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();

    const itemId = String(formData.get("item_id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const priceMdl = Number(formData.get("price_mdl") ?? 0);
    const categoryId = String(formData.get("category_id") ?? "") || null;
    const photoUrl = String(formData.get("photo_url") ?? "").trim() || null;
    const isCateringOnly = formData.get("is_catering_only") === "on";

    if (!itemId) return { error: "Articolul nu a fost găsit." };
    if (!name || priceMdl <= 0) return { error: "Nume și preț valid sunt obligatorii." };

    const { error } = await supabase
      .from("menu_items")
      .update({
        category_id: categoryId,
        name,
        description,
        price_mdl: priceMdl,
        photo_url: photoUrl,
        is_catering_only: isCateringOnly,
      })
      .eq("id", itemId)
      .eq("restaurant_id", restaurantId);
    if (error) return { error: error.message };

    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

// #41 — simple ↑/↓ reorder: swap sort_order with the adjacent item in the same
// restaurant + category. No-op (not an error) once at either edge.
export async function moveMenuItem(itemId: string, direction: "up" | "down"): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();

    const { data: item, error: itemError } = await supabase
      .from("menu_items")
      .select("id, category_id, sort_order")
      .eq("id", itemId)
      .eq("restaurant_id", restaurantId)
      .single();
    if (itemError || !item) return { error: "Articolul nu a fost găsit." };

    let neighborQuery = supabase.from("menu_items").select("id, sort_order").eq("restaurant_id", restaurantId);
    neighborQuery = item.category_id ? neighborQuery.eq("category_id", item.category_id) : neighborQuery.is("category_id", null);
    neighborQuery =
      direction === "up"
        ? neighborQuery.lt("sort_order", item.sort_order).order("sort_order", { ascending: false })
        : neighborQuery.gt("sort_order", item.sort_order).order("sort_order", { ascending: true });

    const { data: neighbor } = await neighborQuery.limit(1).maybeSingle();
    if (!neighbor) return { error: null };

    const { error: err1 } = await supabase.from("menu_items").update({ sort_order: neighbor.sort_order }).eq("id", item.id);
    if (err1) return { error: "Reordonarea a eșuat." };
    const { error: err2 } = await supabase.from("menu_items").update({ sort_order: item.sort_order }).eq("id", neighbor.id);
    if (err2) return { error: "Reordonarea a eșuat." };

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
    if (error) {
      // #17 — order_items.menu_item_id is a NO ACTION FK: once an item was ever
      // ordered, deleting it fails permanently. Archive it instead of hard-failing.
      if (error.code === "23503") {
        const { error: archiveError } = await supabase.from("menu_items").update({ is_available: false }).eq("id", itemId);
        if (archiveError) return { error: archiveError.message };
        revalidatePath("/restaurant/menu");
        return { error: "Produsul are comenzi istorice — a fost dezactivat în loc de șters." };
      }
      return { error: error.message };
    }

    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
