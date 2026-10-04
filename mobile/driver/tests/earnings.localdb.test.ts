import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { fetchCommissionPct, fetchEarningsSince, fetchPricingHistory, fetchTodayEarnings, fetchWeekEarnings } from "../src/lib/earnings";
import { COMMISSION_PCT, currentWeekRange, todayStart } from "@chisinau/shared-domain";

// The app's OWN money functions, signed in as the seeded courier against the
// LOCAL Supabase API (RLS on, exactly what the phone sees), compared with an
// independent SQL computation over the same rows (psql in the DB container).
// Opt-in: LOCAL_SUPABASE_URL + LOCAL_SUPABASE_ANON_KEY (from `supabase status -o env`).
// Read-only: no row is written.
const URL = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const COURIER_EMAIL = process.env.LOCAL_COURIER_EMAIL ?? "curier@test.md";
const COURIER_PASSWORD = process.env.LOCAL_COURIER_PASSWORD ?? "parola123";
const DOCKER = process.env.DOCKER_BIN ?? "/opt/homebrew/bin/docker";

function sql(query: string): string {
  return execFileSync(DOCKER, ["exec", "supabase_db_chisinau-delivery", "psql", "-U", "postgres", "-d", "postgres", "-Atc", query], {
    encoding: "utf8",
  }).trim();
}

// Payout model in SQL, admin_generate_payouts' own expression: per order
// round(fee × pricing_config_at(delivered_at).courier_commission_pct / 100, 2),
// then summed — paid only. (Fallback when no version yet = the app's default.)
function sqlTotals(courierId: string, startIso: string, endIso: string | null) {
  const window = `o.delivered_at >= '${startIso}'` + (endIso ? ` and o.delivered_at < '${endIso}'` : "");
  const row = sql(`
    select count(*) filter (where o.payment_status = 'paid'),
           count(*) filter (where o.payment_status <> 'paid'),
           coalesce(sum(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0)) filter (where o.payment_status = 'paid'), 0),
           coalesce(sum(round(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl)
                              * coalesce(pc.courier_commission_pct, ${COMMISSION_PCT}) / 100, 2)) filter (where o.payment_status = 'paid'), 0)
    from public.orders o
    left join lateral public.pricing_config_at(o.delivered_at) pc on true
    where o.courier_id = '${courierId}' and o.status = 'delivered' and ${window}`);
  const [paid, pending, gross, payoutCommission] = row.split("|").map(Number);
  return {
    ordersCount: paid,
    pendingCount: pending,
    grossMdl: gross,
    payoutNet: Math.round((gross - payoutCommission) * 100) / 100,
  };
}

describe.skipIf(!URL || !ANON)("money vs local DB (as the courier, through RLS)", () => {
  it("all-time, this week and today: app == payout formula, to the ban", async () => {
    const db = createClient<Database>(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signInError } = await db.auth.signInWithPassword({ email: COURIER_EMAIL, password: COURIER_PASSWORD });
    expect(signInError).toBeNull();
    const { data: courier } = await db.from("couriers").select("id").maybeSingle();
    expect(courier?.id).toBeTruthy();
    const courierId = courier!.id;

    const pct = await fetchCommissionPct(db);
    expect(pct).toBe(Number(sql("select courier_commission_pct from public.current_pricing_config()")));
    const history = await fetchPricingHistory(db);
    expect(history.length).toBeGreaterThan(0);

    const now = new Date();
    const allStart = new Date("2020-01-01T00:00:00Z");
    const { start: wStart, end: wEnd } = currentWeekRange(now);
    const cases = [
      { name: "all-time", app: await fetchEarningsSince(db, courierId, allStart, null, history), sql: sqlTotals(courierId, allStart.toISOString(), null) },
      { name: "week", app: await fetchWeekEarnings(db, courierId, history, now), sql: sqlTotals(courierId, wStart.toISOString(), wEnd.toISOString()) },
      { name: "today", app: await fetchTodayEarnings(db, courierId, history, now), sql: sqlTotals(courierId, todayStart(now).toISOString(), null) },
    ];
    for (const c of cases) {
      console.log(`[${c.name}] app net=${c.app.netMdl} gross=${c.app.grossMdl} paid=${c.app.ordersCount} pending=${c.app.pendingCount} | sql payout-net=${c.sql.payoutNet}`);
      expect(c.app.ordersCount).toBe(c.sql.ordersCount);
      expect(c.app.pendingCount).toBe(c.sql.pendingCount);
      expect(c.app.grossMdl).toBe(c.sql.grossMdl);
      expect(c.app.netMdl).toBe(c.sql.payoutNet);
    }
    expect(cases[0].app.ordersCount).toBeGreaterThan(0); // the comparison must not be vacuous

    await db.auth.signOut();
  });
});
