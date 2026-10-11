"use server";

import { revalidatePath } from "next/cache";
import { requireOwnRestaurant } from "@/lib/auth/require";

export type SoldOutMode = "today" | "indefinite" | "off";

// The RPC checks has_restaurant_access on the item's restaurant and the mode.
export async function setItemSoldOut(itemId: string, mode: SoldOutMode): Promise<{ error: string | null }> {
  try {
    const { supabase } = await requireOwnRestaurant();
    const { error } = await supabase.rpc("set_menu_item_sold_out", { p_item_id: itemId, p_mode: mode });
    if (error) return { error: "Starea produsului nu s-a putut salva. Reîncearcă." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  revalidatePath("/restaurant/stoc");
  return { error: null };
}
