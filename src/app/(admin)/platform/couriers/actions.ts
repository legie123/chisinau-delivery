"use server";

import { revalidatePath } from "next/cache";
import { reinstateCourier, RpcError, suspendCourier } from "@chisinau/shared-api";
import { asCourierId } from "@chisinau/shared-types";
import { requirePlatformAdmin } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionState = { error: string | null };

export async function inviteCourier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requirePlatformAdmin();

    const email = String(formData.get("email") ?? "").trim();
    const fullName = String(formData.get("full_name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const vehicleType = String(formData.get("vehicle_type") ?? "car");

    if (!email || !fullName || !phone) {
      return { error: "Email, nume și telefon sunt obligatorii." };
    }

    const admin = createAdminClient();

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, role: "courier" },
    });
    if (inviteError) return { error: inviteError.message };

    const userId = invited.user.id;

    const { error: profileError } = await admin
      .from("profiles")
      .insert({ id: userId, full_name: fullName, phone, role: "courier" });
    if (profileError) return { error: profileError.message };

    const { error: courierError } = await admin
      .from("couriers")
      .insert({ user_id: userId, full_name: fullName, phone, vehicle_type: vehicleType });
    if (courierError) return { error: courierError.message };

    revalidatePath("/platform/couriers");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

// EU 2024/2831 Art 10(5)+11: deactivating a courier is a SUSPENSION — a human admin
// decision with a mandatory written reason + a recorded contest window, not a silent
// toggle. Reactivation lifts it (appeal upheld).
export async function suspendCourierAction(courierId: string, reason: string): Promise<ActionState> {
  try {
    const { supabase } = await requirePlatformAdmin();
    await suspendCourier(supabase, asCourierId(courierId), reason);
    revalidatePath("/platform/couriers");
    return { error: null };
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function reinstateCourierAction(courierId: string, note?: string): Promise<ActionState> {
  try {
    const { supabase } = await requirePlatformAdmin();
    await reinstateCourier(supabase, asCourierId(courierId), note);
    revalidatePath("/platform/couriers");
    return { error: null };
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
