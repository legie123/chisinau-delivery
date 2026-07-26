"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require";
import {
  acceptDispatchOffer,
  advanceDeliveryStatus,
  claimOrderAsCourier,
  declineDispatchOffer,
  RpcError,
  setCourierOnlineStatus,
  submitCourierSatisfaction,
} from "@chisinau/shared-api";
import { asOfferId, asOrderId, type OrderStatus } from "@chisinau/shared-types";

// Customer status pushes are enqueued durably by the delivery_status_events trigger
// (enqueue_customer_status_push) — no more fire-and-forget from the action thread.

export type ActionResult = { error: string | null };

export async function setOnlineStatus(online: boolean): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }

  try {
    await setCourierOnlineStatus(supabase, online);
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut schimba starea." };
  }
  revalidatePath("/deliveries");
  return { error: null };
}

export async function acceptDelivery(orderId: string): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }

  try {
    await claimOrderAsCourier(supabase, asOrderId(orderId));
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut prelua comanda." };
  }
  revalidatePath("/deliveries");
  return { error: null };
}

export async function advanceStatus(
  orderId: string,
  newStatus: string,
  paymentConfirmed?: boolean,
): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }

  try {
    await advanceDeliveryStatus(supabase, asOrderId(orderId), newStatus as OrderStatus, paymentConfirmed);
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut actualiza starea." };
  }
  revalidatePath("/deliveries");
  revalidatePath(`/deliveries/${orderId}`);
  return { error: null };
}

// WS2 — push-dispatch offer response. The RPCs authorize via couriers.user_id
// = auth.uid(); accept does the atomic claim, decline cascades to the next
// candidate. Both are idempotent on retry.
// Routed through the shared-api wrappers (@chisinau/shared-api) — the single typed
// definition of these RPC contracts, shared with Expo. RpcError carries a uniform
// Romanian userMessage so web + mobile show the same words for the same failure.
export async function acceptOffer(offerId: string): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await acceptDispatchOffer(supabase, asOfferId(offerId));
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut accepta oferta." };
  }
  revalidatePath("/deliveries");
  return { error: null };
}

// Faza 5 #5 — weekly courier satisfaction pulse (target >=4.5/5). The RPC
// computes week_start server-side and enforces one-per-week + immutability.
export async function submitSatisfaction(stars: number, comment?: string): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }

  try {
    await submitCourierSatisfaction(supabase, stars, comment);
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut trimite răspunsul." };
  }
  revalidatePath("/deliveries");
  return { error: null };
}

export async function declineOffer(offerId: string): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await declineDispatchOffer(supabase, asOfferId(offerId));
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut refuza oferta." };
  }
  revalidatePath("/deliveries");
  return { error: null };
}
