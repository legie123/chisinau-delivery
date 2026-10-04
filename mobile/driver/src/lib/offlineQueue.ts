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

export type AdvanceResult = { error: string | null; queued: boolean };

export async function advanceOrEnqueue(
  orderId: string,
  target: OrderStatus,
  paymentConfirmed?: boolean,
): Promise<AdvanceResult> {
  const entry = { orderId, newStatus: target, paymentConfirmed, ts: Date.now() };
  const state = await Network.getNetworkStateAsync().catch(() => null);
  if (state && state.isConnected === false) {
    await statusQueue.enqueue(entry);
    return { error: null, queued: true };
  }
  try {
    await advanceThrough(supabase, orderId, target, paymentConfirmed);
    return { error: null, queued: false };
  } catch (err) {
    if (isNetworkError(err)) {
      await statusQueue.enqueue(entry);
      return { error: null, queued: true };
    }
    return { error: err instanceof RpcError ? err.userMessage : "Nu am putut actualiza statusul. Încearcă din nou.", queued: false };
  }
}
