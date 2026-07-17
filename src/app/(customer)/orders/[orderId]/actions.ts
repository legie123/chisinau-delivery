"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require";

export type ActionResult = { error: string | null };

// WS6 — post-delivery rating. The submit_rating RPC enforces caller = customer,
// order delivered, 30-day window, one-per-order-per-target, idempotent retry.
export async function submitRating(
  orderId: string,
  target: "restaurant" | "courier",
  stars: number,
  comment?: string,
): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }

  const { error } = await supabase.rpc("submit_rating", {
    p_order_id: orderId,
    p_target: target,
    p_stars: stars,
    p_comment: comment ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/orders/${orderId}`);
  return { error: null };
}
