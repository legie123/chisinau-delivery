import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import { RpcError } from "@chisinau/shared-api";
import { createStatusQueue, isNetworkError } from "@chisinau/shared-domain";
import type { OrderStatus } from "@chisinau/shared-types";
import { supabase } from "./supabase";
import { advanceThrough, makeQueueAdvance } from "./advance";

// The web's offline status queue (statusQueue), same implementation, native
// store. A courier in a stairwell taps "Am livrat": instead of an error and a
// stuck order, the intent is persisted and replayed (idempotently) on reconnect.
export const statusQueue = createStatusQueue(AsyncStorage);
export const queueAdvance = makeQueueAdvance(supabase);

export function drainStatusQueue(): Promise<void> {
  return statusQueue.drain(queueAdvance);
}

// `closed`: the order can no longer be moved from this screen (cancelled, or
// already advanced elsewhere) — the screen should stop GPS and close.
export type AdvanceResult = { error: string | null; queued: boolean; closed?: boolean };

// The queue refuses (Romanian error) when it cannot read what it already holds,
// rather than overwrite other pending taps — surface that, never throw.
async function enqueue(entry: Parameters<typeof statusQueue.enqueue>[0]): Promise<AdvanceResult> {
  try {
    await statusQueue.enqueue(entry);
    return { error: null, queued: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Nu am putut salva acțiunea offline. Încearcă din nou.", queued: false };
  }
}

export async function advanceOrEnqueue(
  orderId: string,
  target: OrderStatus,
  paymentConfirmed?: boolean,
): Promise<AdvanceResult> {
  const entry = { orderId, newStatus: target, paymentConfirmed, ts: Date.now() };
  const state = await Network.getNetworkStateAsync().catch(() => null);
  if (state && state.isConnected === false) return enqueue(entry);
  try {
    await advanceThrough(supabase, orderId, target, paymentConfirmed);
    return { error: null, queued: false };
  } catch (err) {
    if (isNetworkError(err)) return enqueue(entry);
    const message = err instanceof Error ? err.message : "";
    // advanceThrough / advance_delivery_status: "invalid transition <from> -> <to>".
    const moved = message.match(/invalid transition (\w+) ->/);
    if (moved) {
      const cancelled = moved[1] === "cancelled" || moved[1] === "rejected";
      return {
        error: cancelled ? "Comanda a fost anulată." : "Comanda a fost deja actualizată din alt loc — nu mai e nimic de făcut aici.",
        queued: false,
        closed: true,
      };
    }
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut actualiza statusul. Încearcă din nou.", queued: false };
  }
}
