import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;

// Order 2 (pilot-critical) — PER-DELIVERY COURIER TARIFF. courier_tariff_config
// is versioned + immutable, exactly like pricing_config/cash_policy: a retune
// is always a NEW row, never a silent edit. mark_ready_for_pickup stamps
// orders.courier_fee_quoted_mdl (a FLOOR) and advance_delivery_status stamps
// orders.courier_fee_mdl at delivered — both read directly off the order row
// by existing callers, so no getter wrapper is needed here; current_courier_tariff()
// is internal-only (revoked from every client role) by design.

/**
 * Admin retunes the (provisional) per-delivery courier tariff — versioned +
 * immutable history, mirrors setCashPolicy/set_pricing_config. Announces the
 * change to every active courier via the outbox (tag='pricing').
 */
export async function setCourierTariff(
  db: Db,
  baseMdl: number,
  perKmMdl: number,
  waitPerMinMdl: number,
  waitGraceMinutes?: number,
  effectiveFrom?: string,
  note?: string,
  weatherSurchargeMdl?: number,
): Promise<string> {
  const { data, error } = await db.rpc("set_courier_tariff", {
    p_base_mdl: baseMdl,
    p_per_km_mdl: perKmMdl,
    p_wait_per_min_mdl: waitPerMinMdl,
    p_wait_grace_minutes: waitGraceMinutes,
    p_effective_from: effectiveFrom,
    p_note: note,
    p_weather_surcharge_mdl: weatherSurchargeMdl,
  });
  if (error) throw new RpcError(error);
  return data as string;
}
