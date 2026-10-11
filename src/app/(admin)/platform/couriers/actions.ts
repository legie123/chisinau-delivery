"use server";

import { revalidatePath } from "next/cache";
import { recordCashOffload, reinstateCourier, RpcError, suspendCourier, mapPgError, authErrorText } from "@chisinau/shared-api";
import { asCourierId } from "@chisinau/shared-types";
import { requirePlatformAdmin } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionState = { error: string | null };

export async function inviteCourier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user: actor } = await requirePlatformAdmin();

    const email = String(formData.get("email") ?? "").trim();
    const fullName = String(formData.get("full_name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const vehicleType = String(formData.get("vehicle_type") ?? "car");

    if (!email || !fullName || !phone) {
      return { error: "Email, nume și telefon sunt obligatorii." };
    }

    const admin = createAdminClient(actor.id);

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, role: "courier" },
    });
    if (inviteError) return { error: authErrorText(inviteError) };

    const userId = invited.user.id;

    const { error: profileError } = await admin
      .from("profiles")
      .insert({ id: userId, full_name: fullName, phone, role: "courier" });
    if (profileError) return { error: mapPgError(profileError) };

    const { error: courierError } = await admin
      .from("couriers")
      .insert({ user_id: userId, full_name: fullName, phone, vehicle_type: vehicleType });
    if (courierError) return { error: mapPgError(courierError) };

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

// Simulare pilot 2026-08-15: predarea numerarului e cea mai frecventă operațiune
// a zilei (3,8 predări/curier la 75 comenzi). RPC-ul exista din iulie, dar NU
// avea niciun apelant în UI — un curier ajuns la plafon rămânea blocat definitiv,
// fără cale de deblocare din aplicație. Ăsta e butonul care lipsea.
export async function recordCashOffloadAction(
  courierId: string,
  amountMdl: number,
  note?: string,
): Promise<ActionState> {
  try {
    const { supabase } = await requirePlatformAdmin();
    await recordCashOffload(supabase, asCourierId(courierId), amountMdl, note);
    revalidatePath("/platform/couriers");
    revalidatePath("/platform");
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
