"use server";

import { revalidatePath } from "next/cache";
import { mapPgError } from "@chisinau/shared-api";
import { requireOwnRestaurant } from "@/lib/auth/require";
import { parseMenuSheet } from "./parse";

export type ImportState = { error: string | null; imported?: number; skipped?: string[]; createdCategories?: number };

// Bulk import. Items land HIDDEN (is_available=false): a dish goes public only
// with a photo (createMenuItem's rule), and toggleItemAvailability refuses to
// publish one without it. Validation is all-or-nothing; existing dishes (same
// name in the same category) are skipped, never overwritten.
export async function importMenu(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const { rows, errors } = parseMenuSheet(String(formData.get("sheet") ?? ""));
  if (errors.length) return { error: errors.slice(0, 10).join("\n") + (errors.length > 10 ? `\n… și încă ${errors.length - 10}.` : "") };
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();
    const [{ data: cats }, { data: items }] = await Promise.all([
      supabase.from("menu_categories").select("id, name, sort_order").eq("restaurant_id", restaurantId),
      supabase.from("menu_items").select("name, category_id, sort_order").eq("restaurant_id", restaurantId),
    ]);
    const catId = new Map((cats ?? []).map((c) => [c.name.trim().toLowerCase(), c.id as string]));
    let catSort = Math.max(0, ...(cats ?? []).map((c) => c.sort_order));
    const newCats = [...new Set(rows.map((r) => r.category).filter((c) => c && !catId.has(c.toLowerCase())))];
    if (newCats.length) {
      const { data: created, error } = await supabase
        .from("menu_categories")
        .insert(newCats.map((name) => ({ restaurant_id: restaurantId, name, sort_order: ++catSort })))
        .select("id, name");
      if (error) return { error: mapPgError(error) };
      for (const c of created ?? []) catId.set(c.name.trim().toLowerCase(), c.id);
    }

    const existing = new Set((items ?? []).map((i) => `${i.category_id}|${i.name.trim().toLowerCase()}`));
    const nextSort = new Map<string, number>();
    for (const i of items ?? []) nextSort.set(String(i.category_id), Math.max(nextSort.get(String(i.category_id)) ?? 0, i.sort_order));
    const skipped: string[] = [];
    const inserts = [];
    for (const r of rows) {
      const categoryId = r.category ? catId.get(r.category.toLowerCase())! : null;
      if (existing.has(`${categoryId}|${r.name.toLowerCase()}`)) {
        skipped.push(r.name);
        continue;
      }
      const s = (nextSort.get(String(categoryId)) ?? 0) + 1;
      nextSort.set(String(categoryId), s);
      inserts.push({
        restaurant_id: restaurantId,
        category_id: categoryId,
        name: r.name,
        description: r.description,
        price_mdl: r.price,
        is_available: false,
        sort_order: s,
      });
    }
    if (inserts.length) {
      const { error } = await supabase.from("menu_items").insert(inserts);
      if (error) return { error: mapPgError(error) };
    }
    revalidatePath("/restaurant/menu");
    return { error: null, imported: inserts.length, skipped, createdCategories: newCats.length };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
