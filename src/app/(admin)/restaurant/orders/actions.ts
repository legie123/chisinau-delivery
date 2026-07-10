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

export async function acceptOrder(orderId: string) {
  const supabase = await requireAuth();
  const { error } = await supabase.rpc("accept_order", { p_order_id: orderId });
  if (error) throw new Error(error.message);
  revalidatePath("/restaurant/orders");
}

export async function rejectOrder(orderId: string, reason: string) {
  const supabase = await requireAuth();
  const { error } = await supabase.rpc("reject_order", { p_order_id: orderId, p_reason: reason });
  if (error) throw new Error(error.message);
  revalidatePath("/restaurant/orders");
}

export async function markReadyForPickup(orderId: string) {
  const supabase = await requireAuth();
  const { error } = await supabase.rpc("mark_ready_for_pickup", { p_order_id: orderId });
  if (error) throw new Error(error.message);
  revalidatePath("/restaurant/orders");
}
