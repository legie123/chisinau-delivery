"use server";

import { revalidatePath } from "next/cache";
import { RpcError, submitRating as submitRatingRpc } from "@chisinau/shared-api";
import { asOrderId } from "@chisinau/shared-types";
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

  try {
    await submitRatingRpc(supabase, asOrderId(orderId), target, stars, comment);
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut trimite evaluarea." };
  }
  revalidatePath(`/orders/${orderId}`);
  return { error: null };
}
