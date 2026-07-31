"use server";

import { revalidatePath } from "next/cache";
import {
  adminAssignCourier,
  adminReassignCourier,
  adminUpdatePaymentStatus,
  advanceDeliveryStatus,
  cancelOrder,
  RpcError,
} from "@chisinau/shared-api";
import { asCourierId, asOrderId, type OrderStatus } from "@chisinau/shared-types";
import { requirePlatformAdmin } from "@/lib/auth/require";

function surfaced(err: unknown, fallback: string): string {
  return err instanceof RpcError ? err.userMessage : fallback;
}

export type ActionResult = { error: string | null };

// Defense in depth: these ops actions are a platform_admin surface. The underlying
// RPCs already authorize, but gate here too so a non-admin can never even reach them
// (audit #64) rather than relying solely on downstream RLS/RPC checks.
async function client() {
  const { supabase } = await requirePlatformAdmin();
  return supabase;
}

// All three are thin wrappers over EXISTING guarded RPCs (cancel_order and
// advance_delivery_status already allow platform_admin) plus the WS7 payment RPC.
// RLS/RPC authorization is the real boundary; these just surface errors to the UI.
export async function cancelStuckOrder(orderId: string, reason: string): Promise<ActionResult> {
  let supabase;
  try {
    supabase = await client();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await cancelOrder(supabase, asOrderId(orderId), reason);
  } catch (err) {
    return { error: surfaced(err, "Nu am putut anula comanda.") };
  }
  revalidatePath("/platform/queues");
  revalidatePath(`/platform/orders/${orderId}`);
  return { error: null };
}

export async function forceAdvance(orderId: string, newStatus: string): Promise<ActionResult> {
  let supabase;
  try {
    supabase = await client();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await advanceDeliveryStatus(supabase, asOrderId(orderId), newStatus as OrderStatus);
  } catch (err) {
    return { error: surfaced(err, "Nu am putut actualiza starea.") };
  }
  revalidatePath("/platform/queues");
  revalidatePath(`/platform/orders/${orderId}`);
  return { error: null };
}

// Wave D2 — admin reassigns a stuck in-flight order to another available courier
// (a ghosting courier otherwise forces fake-completion). Guarded RPC via shared-api.
export async function reassignCourier(orderId: string, courierId: string): Promise<ActionResult> {
  let supabase;
  try {
    supabase = await client();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await adminReassignCourier(supabase, asOrderId(orderId), asCourierId(courierId));
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut reatribui curierul." };
  }
  revalidatePath("/platform/queues");
  revalidatePath(`/platform/orders/${orderId}`);
  return { error: null };
}

// SurfaceAudit P2 — admin ASSIGNS a courier to a ready_for_pickup order that was
// never picked up (fully-canvassed dispatch pool). The courier_id IS NULL sibling
// of reassignCourier. Guarded RPC via shared-api (admin_assign_courier).
export async function assignCourier(orderId: string, courierId: string): Promise<ActionResult> {
  let supabase;
  try {
    supabase = await client();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await adminAssignCourier(supabase, asOrderId(orderId), asCourierId(courierId));
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut atribui curierul." };
  }
  revalidatePath("/platform/queues");
  revalidatePath(`/platform/orders/${orderId}`);
  return { error: null };
}

export async function resolvePayment(orderId: string, newStatus: string, note?: string): Promise<ActionResult> {
  let supabase;
  try {
    supabase = await client();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  try {
    await adminUpdatePaymentStatus(supabase, asOrderId(orderId), newStatus, note);
  } catch (err) {
    return { error: surfaced(err, "Nu am putut actualiza plata.") };
  }
  revalidatePath("/platform/queues");
  revalidatePath(`/platform/orders/${orderId}`);
  return { error: null };
}
