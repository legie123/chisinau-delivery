"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionState = { error: string | null };

async function requirePlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Neautentificat.");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "platform_admin") throw new Error("Acces interzis.");
}

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

export async function setCourierActive(courierId: string, isActive: boolean) {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("couriers").update({ is_active: isActive }).eq("id", courierId);
  if (error) throw new Error(error.message);
  revalidatePath("/platform/couriers");
}
