import { createClient } from "@/lib/supabase/server";
import { PremiumReveal } from "@/components/admin/premium/PremiumReveal";
import { RestaurantWaitKpiChips } from "@/components/admin/RestaurantWaitKpiChips";
import { SvgBars, type SvgBarDatum } from "@/components/charts/SvgBars";
import type {
  RestaurantAnalyticsDailyRow,
  RestaurantAnalyticsHourlyRow,
  RestaurantTopItemRow,
  RestaurantWaitKpiRow,
} from "@/lib/types/domain";

// Partner analytics — premium SVG histograms over the read-only views shipped
// in migration 20260728000000 (restaurant_analytics_hourly/daily/top_items).
// All three are security_invoker views scoped by has_restaurant_access, so a
// plain `.from()` select (no RPC wrapper needed — matches admin_order_board).

const fmtMdl = (n: number) => `${Number(n).toLocaleString("ro-RO", { maximumFractionDigits: 0 })} MDL`;
const fmtCount = (n: number) => String(n);

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="pg-card flex flex-col items-center gap-2 rounded-2xl px-4 py-10 text-center">
      <span className="text-3xl" aria-hidden>
        📊
      </span>
      <p className="text-sm text-white/50">
        {label} — Datele se adună — revino după primele comenzi.
      </p>
    </div>
  );
}

export default async function RestaurantAnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Multi-restaurant partner guard: .maybeSingle() throws on 2+ rows — take
  // the primary (oldest) link so the page never 500s (matches orders/earnings).
  const { data: staffRows } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id")
    .eq("user_id", user?.id ?? "")
    .order("created_at", { ascending: true })
    .limit(1);
  const staffRow = staffRows?.[0] ?? null;

  if (!staffRow) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16 text-center">
        <p className="text-white/60">Contul tău nu este asociat cu un restaurant.</p>
      </main>
    );
  }

  const restaurantId = staffRow.restaurant_id;
  const [{ data: kpiRow }, { data: hourlyRows }, { data: dailyRows }, { data: topRows }] = await Promise.all([
    supabase.from("restaurant_wait_kpis").select("*").eq("restaurant_id", restaurantId).maybeSingle(),
    supabase
      .from("restaurant_analytics_hourly")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("hour_of_day"),
    supabase.from("restaurant_analytics_daily").select("*").eq("restaurant_id", restaurantId).order("day"),
    supabase
      .from("restaurant_top_items")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("qty", { ascending: false }),
  ]);

  const waitKpi = (kpiRow as RestaurantWaitKpiRow | null) ?? null;
  const hourly = (hourlyRows ?? []) as RestaurantAnalyticsHourlyRow[];
  const daily = (dailyRows ?? []) as RestaurantAnalyticsDailyRow[];
  const topItems = (topRows ?? []) as RestaurantTopItemRow[];

  const hourlyTotal = hourly.reduce((s, r) => s + r.orders_count, 0);
  const dailyTotal = daily.reduce((s, r) => s + r.revenue_mdl, 0);
  const maxDailyRevenue = Math.max(...daily.map((r) => r.revenue_mdl), 0);

  const hourlyBars: SvgBarDatum[] = hourly.map((r) => ({
    key: String(r.hour_of_day),
    label: `${r.hour_of_day}`,
    value: r.orders_count,
    tooltip: `Ora ${r.hour_of_day}:00 — ${r.orders_count} ${r.orders_count === 1 ? "comandă" : "comenzi"}`,
  }));

  const dailyBars: SvgBarDatum[] = daily.map((r) => ({
    key: r.day,
    label: new Date(r.day).toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" }),
    value: r.revenue_mdl,
    highlight: r.revenue_mdl > 0 && r.revenue_mdl === maxDailyRevenue,
    tooltip: `${new Date(r.day).toLocaleDateString("ro-RO", { day: "numeric", month: "long", timeZone: "UTC" })} — ${fmtMdl(r.revenue_mdl)}`,
  }));

  const topBars: SvgBarDatum[] = topItems.map((r) => ({
    key: r.item_name,
    label: r.item_name,
    value: r.qty,
    secondaryLabel: `${r.qty} buc · ${fmtMdl(r.revenue_mdl)}`,
    tooltip: `${r.item_name}: ${r.qty} buc · ${fmtMdl(r.revenue_mdl)}`,
  }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <h1 className="pg-gold-text font-serif text-2xl font-bold">Analiză</h1>
      <p className="mb-4 mt-1 text-sm text-white/50">Comportamentul comenzilor tale, la vedere.</p>

      {waitKpi && <RestaurantWaitKpiChips kpi={waitKpi} />}

      <PremiumReveal as="section" className="pg-card mb-6 rounded-2xl p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/70">
          Comenzi pe ore <span className="ml-1 text-white/35">· ultimele 14 zile</span>
        </h2>
        {hourlyTotal === 0 ? (
          <EmptyChart label="Comenzi pe ore" />
        ) : (
          <SvgBars
            data={hourlyBars}
            orientation="vertical"
            width={640}
            height={200}
            gradientId="rest-hourly"
            valueFormatter={fmtCount}
            ariaLabel="Comenzi pe ore, ultimele 14 zile"
            axisLabelEvery={3}
          />
        )}
      </PremiumReveal>

      <PremiumReveal as="section" delay={60} className="pg-card mb-6 rounded-2xl p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/70">
          Venit pe zile <span className="ml-1 text-white/35">· ultimele 14 zile</span>
        </h2>
        {dailyTotal === 0 ? (
          <EmptyChart label="Venit pe zile" />
        ) : (
          <SvgBars
            data={dailyBars}
            orientation="vertical"
            width={640}
            height={200}
            gradientId="rest-daily"
            valueFormatter={fmtMdl}
            ariaLabel="Venit pe zile, ultimele 14 zile"
            axisLabelEvery={2}
          />
        )}
      </PremiumReveal>

      <PremiumReveal as="section" delay={120} className="pg-card rounded-2xl p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/70">
          Top preparate <span className="ml-1 text-white/35">· ultimele 28 zile</span>
        </h2>
        {topItems.length === 0 ? (
          <EmptyChart label="Top preparate" />
        ) : (
          <SvgBars
            data={topBars}
            orientation="horizontal"
            width={640}
            height={Math.max(topItems.length * 34, 34)}
            gradientId="rest-top-items"
            valueFormatter={fmtCount}
            ariaLabel="Top preparate după cantitate, ultimele 28 zile"
          />
        )}
      </PremiumReveal>
    </main>
  );
}
