"use server";

import { revalidatePath } from "next/cache";
import { cancelOrder, confirmCateringQuote as confirmCateringQuoteRpc, RpcError } from "@chisinau/shared-api";
import { asOrderId } from "@chisinau/shared-types";
import { createClient } from "@/lib/supabase/server";

// Server Actions return {error} instead of throwing — production Next.js
// redacts thrown Server Action messages, so a thrown Supabase error would
// reach the client as a useless generic string. Every RPC goes through a typed
// @chisinau/shared-api wrapper (RpcError → uniform Romanian userMessage).
export type ActionResult = { error: string | null };

/** `shownTotal` = the quoted amount on the page; a re-quote in between is refused server-side (sim 114). */
export async function confirmCateringQuote(orderId: string, shownTotal?: number | null): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Neautentificat." };

  try {
    await confirmCateringQuoteRpc(supabase, asOrderId(orderId), shownTotal);
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut confirma oferta." };
  }
  revalidatePath(`/catering/${orderId}`);
  return { error: null };
}

export async function cancelCateringOrder(orderId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Neautentificat." };

  try {
    await cancelOrder(supabase, asOrderId(orderId), reason);
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut anula comanda." };
  }
  revalidatePath(`/catering/${orderId}`);
  return { error: null };
}
