"use server";

import { revalidatePath } from "next/cache";
import {
  declineCateringQuote as declineCateringQuoteRpc,
  markReadyForPickup as markReadyRpc,
  RpcError,
  submitCateringQuote as submitCateringQuoteRpc,
} from "@chisinau/shared-api";
import { asOrderId } from "@chisinau/shared-types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string | null };

// Catering-quote lifecycle. Every RPC goes through a typed @chisinau/shared-api
// wrapper (the single contract source, shared with Expo); RpcError carries a
// uniform Romanian userMessage.
async function currentClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function submitCateringQuote(orderId: string, quotedTotalMdl: number): Promise<ActionResult> {
  const { supabase, user } = await currentClient();
  if (!user) return { error: "Neautentificat." };
  try {
    await submitCateringQuoteRpc(supabase, asOrderId(orderId), quotedTotalMdl);
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Acțiunea nu a putut fi efectuată." };
  }
  revalidatePath("/restaurant/catering");
  return { error: null };
}

// Once the client confirms the quote, a catering order sits at status 'accepted'
// with no way forward — the standard queue excludes catering, so the kitchen
// could never mark it ready and dispatch never fired. This is that missing hop:
// mark_ready_for_pickup runs the same transition + auth checks + dispatch_order()
// hook as a standard order.
export async function markCateringReady(orderId: string): Promise<ActionResult> {
  const { supabase, user } = await currentClient();
  if (!user) return { error: "Neautentificat." };
  try {
    await markReadyRpc(supabase, asOrderId(orderId));
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Acțiunea nu a putut fi efectuată." };
  }
  revalidatePath("/restaurant/catering");
  return { error: null };
}

export async function declineCateringQuote(orderId: string, reason: string): Promise<ActionResult> {
  const { supabase, user } = await currentClient();
  if (!user) return { error: "Neautentificat." };
  try {
    await declineCateringQuoteRpc(supabase, asOrderId(orderId), reason);
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Acțiunea nu a putut fi efectuată." };
  }
  revalidatePath("/restaurant/catering");
  return { error: null };
}
