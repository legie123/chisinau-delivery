"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Neautentificat.");
  return supabase;
}

export async function setOnlineStatus(online: boolean) {
  const supabase = await requireAuth();
  const { error } = await supabase.rpc("set_courier_online_status", { p_status: online ? "online" : "offline" });
  if (error) throw new Error(error.message);
  revalidatePath("/deliveries");
}

export async function acceptDelivery(orderId: string) {
  const supabase = await requireAuth();
  const { error } = await supabase.rpc("assign_courier", { p_order_id: orderId });
  if (error) throw new Error(error.message);
  revalidatePath("/deliveries");
}

export async function advanceStatus(orderId: string, newStatus: string, paymentConfirmed?: boolean) {
  const supabase = await requireAuth();
  const { error } = await supabase.rpc("advance_delivery_status", {
    p_order_id: orderId,
    p_new_status: newStatus,
    p_payment_confirmed: paymentConfirmed ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/deliveries");
  revalidatePath(`/deliveries/${orderId}`);
}
