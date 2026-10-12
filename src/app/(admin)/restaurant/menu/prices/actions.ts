"use server";

import { revalidatePath } from "next/cache";
import { requireOwnRestaurant } from "@/lib/auth/require";
import { bulkPrices, type BulkMode, type PriceChange } from "./bulk";

// `params` echoes what the server previewed; Apply sends exactly those back, never whatever
// the visible fields hold at click time (a reset <select> once applied +10 % to the whole
// menu after a one-category preview — 21 prices instead of 2, 2026-10-12).
export type BulkParams = { category: string; mode: BulkMode; value: number };
export type BulkState = { error: string | null; changes?: PriceChange[]; applied?: number; params?: BulkParams };

// Preview or apply a bulk price change. Prices are always recomputed from the DB here,
// never taken from the browser; writes are scoped to the partner's own restaurant.
export async function bulkPriceAction(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const category = String(formData.get("category") ?? "all");
  const mode = (formData.get("mode") === "amount" ? "amount" : "percent") as BulkMode;
  const value = Number(String(formData.get("value") ?? "").replace(",", "."));
  const apply = formData.get("intent") === "apply";
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();
    let q = supabase.from("menu_items").select("id, name, price_mdl").eq("restaurant_id", restaurantId).eq("is_catering_only", false);
    if (category !== "all") q = q.eq("category_id", category);
    const { data, error } = await q.order("sort_order");
    if (error) return { error: "Meniul nu a putut fi citit." };
    const { changes, error: rule } = bulkPrices(data ?? [], mode, value);
    if (rule) return { error: rule };
    if (!apply) return { error: null, changes, params: { category, mode, value } };
    for (const c of changes) {
      const { error: upd } = await supabase
        .from("menu_items")
        .update({ price_mdl: c.to })
        .eq("id", c.id)
        .eq("restaurant_id", restaurantId);
      if (upd) return { error: `S-a oprit la „${c.name}”: prețul nu s-a salvat. Cele de dinainte sunt deja schimbate.` };
    }
    revalidatePath("/restaurant/menu");
    return { error: null, applied: changes.length };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
