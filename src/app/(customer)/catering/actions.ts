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

export async function confirmCateringQuote(orderId: string) {
  const supabase = await requireAuth();
  const { error } = await supabase.rpc("confirm_catering_quote", { p_order_id: orderId });
  if (error) throw new Error(error.message);
  revalidatePath(`/catering/${orderId}`);
}

export async function cancelCateringOrder(orderId: string, reason: string) {
  const supabase = await requireAuth();
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId, p_reason: reason });
  if (error) throw new Error(error.message);
  revalidatePath(`/catering/${orderId}`);
}
