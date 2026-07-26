import type { SupabaseClient } from "@supabase/supabase-js";
import type { CourierId, Database } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;
type Fns = Database["public"]["Functions"];

// Order 1 (pilot-critical) — COURIER CASH FLOAT. Cash collected on delivery is
// a liability the courier holds until they hand it in; card_on_delivery
// settles electronically on a POS terminal and never accrues here. The hard
// cap + hysteresis reactivation gate live inside set_courier_online_status
// (courier can't self-serve past it — see lifecycle.ts's setCourierOnlineStatus,
// unchanged signature); these wrappers are the read/offload surface.

export type CourierCashStatus = Fns["get_courier_cash_status"]["Returns"][number];

/** The signed-in courier's own float: balance, cap, reactivation threshold, full offload-channel text. */
export async function getCourierCashStatus(db: Db): Promise<CourierCashStatus | null> {
  const { data, error } = await db.rpc("get_courier_cash_status");
  if (error) throw new RpcError(error);
  return data?.[0] ?? null;
}

/** Admin read of one courier's float (has_role('platform_admin') gated at the DB). */
export async function adminCourierCashStatus(db: Db, courierId: CourierId): Promise<CourierCashStatus | null> {
  const { data, error } = await db.rpc("admin_courier_cash_status", { p_courier_id: courierId });
  if (error) throw new RpcError(error);
  return data?.[0] ?? null;
}

/**
 * Human admin records a cash offload (courier handed over their collections
 * at HQ) — a negative ledger entry, mirrors suspend_courier's admin-only
 * pattern. Pass the amount handed over as a POSITIVE number.
 */
export async function recordCashOffload(
  db: Db,
  courierId: CourierId,
  amountMdl: number,
  note?: string,
): Promise<string> {
  const { data, error } = await db.rpc("record_cash_offload", {
    p_courier_id: courierId,
    p_amount_mdl: amountMdl,
    p_note: note,
  });
  if (error) throw new RpcError(error);
  return data as string;
}

/**
 * Admin retunes the (provisional) cash-float numbers — versioned + immutable
 * history, exactly like set_pricing_config. A change is always a NEW version,
 * never a silent edit of the current one.
 */
export async function setCashPolicy(
  db: Db,
  capMdl: number,
  reactivationThresholdMdl: number,
  offloadChannelText: string,
  effectiveFrom?: string,
  note?: string,
): Promise<string> {
  const { data, error } = await db.rpc("set_cash_policy", {
    p_cap_mdl: capMdl,
    p_reactivation_mdl: reactivationThresholdMdl,
    p_offload_text: offloadChannelText,
    p_effective_from: effectiveFrom,
    p_note: note,
  });
  if (error) throw new RpcError(error);
  return data as string;
}
