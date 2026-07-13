"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Server Actions return {error} instead of throwing — production Next.js
// redacts thrown Server Action messages, so a thrown Supabase error would
// reach the client as a useless generic string.
export type ActionResult = { error: string | null };

export async function confirmCateringQuote(orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Neautentificat." };

  const { error } = await supabase.rpc("confirm_catering_quote", { p_order_id: orderId });
  if (error) return { error: error.message };

  revalidatePath(`/catering/${orderId}`);
  return { error: null };
}

export async function cancelCateringOrder(orderId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Neautentificat." };

  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId, p_reason: reason });
  if (error) return { error: error.message };

  revalidatePath(`/catering/${orderId}`);
  return { error: null };
}
