"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string | null };

export async function submitCateringQuote(orderId: string, quotedTotalMdl: number): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Neautentificat." };

  const { error } = await supabase.rpc("submit_catering_quote", {
    p_order_id: orderId,
    p_quoted_total_mdl: quotedTotalMdl,
  });
  if (error) return { error: error.message };

  revalidatePath("/restaurant/catering");
  return { error: null };
}

// Once the client confirms the quote, a catering order sits at status 'accepted'
// with no way forward — the standard queue excludes catering, so the kitchen
// could never mark it ready and dispatch never fired. This is that missing hop:
// mark_ready_for_pickup runs the same transition + auth checks + dispatch_order()
// hook as a standard order.
export async function markCateringReady(orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Neautentificat." };

  const { error } = await supabase.rpc("mark_ready_for_pickup", { p_order_id: orderId });
  if (error) return { error: error.message };

  revalidatePath("/restaurant/catering");
  return { error: null };
}

export async function declineCateringQuote(orderId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Neautentificat." };

  const { error } = await supabase.rpc("decline_catering_quote", { p_order_id: orderId, p_reason: reason });
  if (error) return { error: error.message };

  revalidatePath("/restaurant/catering");
  return { error: null };
}
