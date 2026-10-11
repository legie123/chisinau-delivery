"use server";

import { revalidatePath } from "next/cache";
import {
  acceptOrder as acceptOrderRpc,
  markReadyForPickup as markReadyRpc,
  rejectOrder as rejectOrderRpc,
  restaurantCancelOrder as restaurantCancelRpc,
  RpcError,
  setPrepTimeEstimate as setPrepTimeEstimateRpc,
} from "@chisinau/shared-api";
import { asOrderId } from "@chisinau/shared-types";
import { requireOwnRestaurant, requireUser } from "@/lib/auth/require";

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

export async function restaurantCancelOrder(orderId: string, reason: string): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await restaurantCancelRpc(supabase, asOrderId(orderId), reason);
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Acțiunea nu a putut fi efectuată." };
  }
  revalidatePath("/restaurant/orders");
  revalidatePath(`/restaurant/orders/${orderId}`);
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

// Order 4 (Glovo model) — merchant prep-time override, editable pre-accept only.
export async function setPrepTimeEstimate(orderId: string, minutes: number): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await setPrepTimeEstimateRpc(supabase, asOrderId(orderId), minutes);
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Acțiunea nu a putut fi efectuată." };
  }
  revalidatePath("/restaurant/orders");
  return { error: null };
}

// Busy mode: +15/30/45 min on every prep estimate for one hour (0 = off). The RPC
// validates the value and the caller's access; the customer ETA and the next
// accepted order's estimated_ready_at both read it through get_prep_estimates.
export async function setRestaurantBusy(minutes: 0 | 15 | 30 | 45): Promise<ActionResult> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();
    const { error } = await supabase.rpc("set_restaurant_busy", {
      p_restaurant_id: restaurantId,
      p_extra_minutes: minutes,
    });
    if (error) return { error: "Modul aglomerat nu s-a putut salva. Reîncearcă." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  revalidatePath("/restaurant/orders");
  return { error: null };
}
