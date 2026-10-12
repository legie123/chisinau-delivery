"use server";

import { revalidatePath } from "next/cache";
import { requireOwnRestaurant } from "@/lib/auth/require";
import { bulkPrices, parseChange, type BulkMode, type PriceChange } from "./bulk";

export type BulkParams = { category: string; mode: BulkMode; value: number };
export type BulkState = {
  error: string | null;
  changes?: PriceChange[];
  params?: BulkParams;
  applied?: number;
  stale?: number;
};

async function scope() {
  return requireOwnRestaurant();
}

// Preview: compute from the DB, return the exact list and the parameters used.
export async function previewBulkPrices(category: string, mode: BulkMode, rawValue: string): Promise<BulkState> {
  const value = parseChange(rawValue);
  if (value === null) return { error: "Scrie un număr, de exemplu 10 sau -5." };
  try {
    const { supabase, restaurantId } = await scope();
    let q = supabase.from("menu_items").select("id, name, price_mdl").eq("restaurant_id", restaurantId).eq("is_catering_only", false);
    if (category !== "all") q = q.eq("category_id", category);
    const { data, error } = await q.order("sort_order");
    if (error) return { error: "Meniul nu a putut fi citit." };
    const { changes, error: rule } = bulkPrices(data ?? [], mode, value);
    if (rule) return { error: rule };
    return { error: null, changes, params: { category, mode, value } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

// Apply EXACTLY the previewed rows: each write is conditional on the price still being the
// previewed `from`, and the new price is recomputed here from `from` + the parameters (never
// taken from the browser). A second tab, a repeated click or a retry after a network error
// therefore cannot compound the change — those rows count as "changed meanwhile" (verifier R2
// on 1c0fa8d: two tabs had written +21 % for a +10 % preview).
export async function applyBulkPrices(params: BulkParams, rows: { id: string; from: number }[]): Promise<BulkState> {
  try {
    const { supabase, restaurantId } = await scope();
    let applied = 0;
    let stale = 0;
    for (const r of rows) {
      const { changes, error: rule } = bulkPrices([{ id: r.id, name: "", price_mdl: r.from }], params.mode, params.value);
      if (rule) return { error: rule };
      if (changes.length === 0) continue;
      const { data, error } = await supabase
        .from("menu_items")
        .update({ price_mdl: changes[0].to })
        .eq("id", r.id)
        .eq("restaurant_id", restaurantId)
        .eq("price_mdl", r.from)
        .select("id");
      if (error) return { error: `S-a oprit după ${applied} prețuri: o scriere a eșuat. Previzualizează din nou ca să vezi starea.`, applied, stale };
      if (data && data.length === 1) applied++;
      else stale++;
    }
    revalidatePath("/restaurant/menu");
    return { error: null, applied, stale };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
