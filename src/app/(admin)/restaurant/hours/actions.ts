"use server";

import { revalidatePath } from "next/cache";
import { requireOwnRestaurant } from "@/lib/auth/require";

export type ActionState = { error: string | null };

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export async function updateHours(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();

    const rows = DAYS.map((day) => {
      // HoursForm no longer pre-fills these visually (an unconfigured day
      // must look unconfigured, not already-set) — so a field left blank
      // submits "" here, not undefined.
      const opensRaw = String(formData.get(`day_${day}_opens`) ?? "").trim();
      const closesRaw = String(formData.get(`day_${day}_closes`) ?? "").trim();
      const checkedClosed = formData.get(`day_${day}_closed`) === "on";
      // #15 — a day left blank used to silently default to open 11:00–22:00,
      // which reads as deliberately configured. An incomplete day (either
      // time missing) is unconfigured, not open: save it as closed instead
      // of guessing hours. 11:00/22:00 are just harmless placeholders here
      // since is_closed=true means nothing ever reads opens_at/closes_at
      // (see src/app/(customer)/restaurants/page.tsx).
      const incomplete = !opensRaw || !closesRaw;
      return {
        restaurant_id: restaurantId,
        day_of_week: day,
        opens_at: opensRaw || "11:00",
        closes_at: closesRaw || "22:00",
        is_closed: checkedClosed || incomplete,
      };
    });

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
