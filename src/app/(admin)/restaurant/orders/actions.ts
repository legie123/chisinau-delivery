"use server";

import { revalidatePath } from "next/cache";
import { acceptOrder as acceptOrderRpc, markReadyForPickup as markReadyRpc, rejectOrder as rejectOrderRpc, RpcError } from "@chisinau/shared-api";
import { asOrderId } from "@chisinau/shared-types";
import { requireUser } from "@/lib/auth/require";

export type ActionResult = { error: string | null };

// Restaurant-partner order-lifecycle actions. Every RPC goes through a typed
// @chisinau/shared-api wrapper (the single source of the contract, shared with
// Expo) — RpcError carries a uniform Romanian userMessage. Customer status pushes
// are enqueued durably by the delivery_status_events trigger, so these no longer
// fire-and-forget them.
export async function acceptOrder(orderId: string): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await acceptOrderRpc(supabase, asOrderId(orderId));
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Acțiunea nu a putut fi efectuată." };
  }
  revalidatePath("/restaurant/orders");
  return { error: null };
}

export async function rejectOrder(orderId: string, reason: string): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await rejectOrderRpc(supabase, asOrderId(orderId), reason);
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Acțiunea nu a putut fi efectuată." };
  }
  revalidatePath("/restaurant/orders");
  return { error: null };
}

export async function markReadyForPickup(orderId: string): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await markReadyRpc(supabase, asOrderId(orderId));
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Acțiunea nu a putut fi efectuată." };
  }
  revalidatePath("/restaurant/orders");
  return { error: null };
}
