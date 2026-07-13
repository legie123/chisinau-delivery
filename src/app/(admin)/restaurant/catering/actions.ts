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

export async function submitCateringQuote(orderId: string, quotedTotalMdl: number) {
  const supabase = await requireAuth();
  const { error } = await supabase.rpc("submit_catering_quote", {
    p_order_id: orderId,
    p_quoted_total_mdl: quotedTotalMdl,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/restaurant/catering");
}

export async function declineCateringQuote(orderId: string, reason: string) {
  const supabase = await requireAuth();
  const { error } = await supabase.rpc("decline_catering_quote", { p_order_id: orderId, p_reason: reason });
  if (error) throw new Error(error.message);
  revalidatePath("/restaurant/catering");
}
