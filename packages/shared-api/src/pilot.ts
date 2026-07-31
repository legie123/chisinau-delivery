import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;

// Faza 5 — Pilot Command Center (admin-only, read-only). The DB computes every
// KPI/trigger; the client only renders. Both throw for non-admins (RpcError).

export type PilotKpiRow = { kpi: string; value_text: string; target_text: string; status: string };
export type ScalingTriggerRow = { trigger_name: string; current_value: string; threshold_text: string; armed: boolean };

/** The audit's Faza-5 go/no-go table — 10 KPIs with pass/fail/no_data/info. */
export async function getPilotGoNoGo(db: Db): Promise<PilotKpiRow[]> {
  const { data, error } = await db.rpc("admin_pilot_go_no_go");
  if (error) throw new RpcError(error);
  return (data ?? []) as PilotKpiRow[];
}

/** The audit's Faza-6 scaling triggers — each with a live query + armed flag. */
export async function getScalingTriggers(db: Db): Promise<ScalingTriggerRow[]> {
  const { data, error } = await db.rpc("admin_scaling_triggers");
  if (error) throw new RpcError(error);
  return (data ?? []) as ScalingTriggerRow[];
}
