"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CuisineType } from "@/lib/types/domain";

export type ActionState = { error: string | null };

export async function createRestaurant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await requirePlatformAdmin();

    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim();
    const cuisineType = String(formData.get("cuisine_type") ?? "other") as CuisineType;
    const address = String(formData.get("address") ?? "").trim();
    const sector = String(formData.get("sector") ?? "").trim() || null;
    const phone = String(formData.get("phone") ?? "").trim();
    const deliveryFee = Number(formData.get("delivery_fee_mdl") ?? 0);
    const minOrder = Number(formData.get("min_order_amount_mdl") ?? 0);

    if (!name || !slug || !address || !phone) {
      return { error: "Nume, slug, adresă și telefon sunt obligatorii." };
    }

    const { error } = await supabase.from("restaurants").insert({
      name,
      slug,
      cuisine_type: cuisineType,
      address,
      sector,
      phone,
      delivery_fee_mdl: deliveryFee,
      min_order_amount_mdl: minOrder,
    });

    if (error) return { error: error.message };

    revalidatePath("/platform/restaurants");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function invitePartner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requirePlatformAdmin();

    const restaurantId = String(formData.get("restaurant_id") ?? "");
    const email = String(formData.get("email") ?? "").trim();
    const fullName = String(formData.get("full_name") ?? "").trim();

    if (!restaurantId || !email || !fullName) {
      return { error: "Restaurant, email și nume sunt obligatorii." };
    }

    const admin = createAdminClient();

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, role: "restaurant_partner" },
    });
    if (inviteError) return { error: inviteError.message };

    const userId = invited.user.id;

    // The customer-signup trigger only provisions profiles for role=customer,
    // so admin-invited roles need their profile + staff link created explicitly.
    const { error: profileError } = await admin
      .from("profiles")
      .insert({ id: userId, full_name: fullName, role: "restaurant_partner" });
    if (profileError) return { error: profileError.message };

    const { error: staffError } = await admin
      .from("restaurant_staff")
      .insert({ restaurant_id: restaurantId, user_id: userId });
    if (staffError) return { error: staffError.message };

    revalidatePath("/platform/restaurants");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

// Courier invite (creating a `couriers` row, not just a profile) lands in
// Phase 3 alongside the couriers_and_deliveries migration.
