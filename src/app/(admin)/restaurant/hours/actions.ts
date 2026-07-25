"use server";

import { revalidatePath } from "next/cache";
import { requireOwnRestaurant } from "@/lib/auth/require";

export type ActionState = { error: string | null };

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export async function updateHours(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();

    const rows = DAYS.map((day) => ({
      restaurant_id: restaurantId,
      day_of_week: day,
      // HoursForm no longer pre-fills these visually (an unconfigured day
      // must look unconfigured, not already-set) — so a field left blank
      // submits "" here, not undefined. `||` catches that; `??` wouldn't.
      opens_at: String(formData.get(`day_${day}_opens`) || "11:00"),
      closes_at: String(formData.get(`day_${day}_closes`) || "22:00"),
      is_closed: formData.get(`day_${day}_closed`) === "on",
    }));

    const { error } = await supabase
      .from("restaurant_hours")
      .upsert(rows, { onConflict: "restaurant_id,day_of_week" });
    if (error) return { error: error.message };

    revalidatePath("/restaurant/hours");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function toggleAcceptingOrders(accepting: boolean): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();
    const { error } = await supabase
      .from("restaurants")
      .update({ accepting_orders: accepting })
      .eq("id", restaurantId);
    if (error) return { error: error.message };
    revalidatePath("/restaurant/hours");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
