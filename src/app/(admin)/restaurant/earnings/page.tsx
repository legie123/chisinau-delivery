import { createClient } from "@/lib/supabase/server";
import { currentWeekRange } from "@chisinau/shared-domain";
import { PremiumReveal } from "@/components/admin/premium/PremiumReveal";
import type { Payout } from "@/lib/types/domain";
import { PayoutAccountForm } from "@/components/admin/PayoutAccountForm";

// "Câștiguri" for the restaurant partner: this-week gross sales (subtotal of
// delivered orders in the Chisinau week Mon–Sun — the payout period, migration
// 20261004000600; it was a rolling 7×24 h window) plus the weekly payouts the
// platform settles to them (net = gross − platform commission). RLS
// (has_restaurant_access) scopes payouts to the partner's own restaurant.
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" });

const round2 = (n: number) => Math.round(n * 100) / 100;

function PayoutStatusBadge({ status }: { status: Payout["status"] }) {
  if (status === "paid")
    return (
      <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
        Plătit ✓
      </span>
    );
  if (status === "failed")
    return <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">Eșuat</span>;
  return <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-semibold text-gold">În așteptare</span>;
}

export default async function RestaurantEarningsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Multi-restaurant partner guard: .maybeSingle() throws on 2+ rows — take the
  // primary (oldest) link so the page never 500s.
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

  const { start: weekStart, end: weekEnd } = currentWeekRange(new Date());
  // Current + 3 previous Chișinău weeks for the CSV export links.
  const exportWeeks = [0, 1, 2, 3].map((i) => {
    const w = currentWeekRange(new Date(weekStart.getTime() - i * 7 * 86_400_000 + 12 * 3_600_000));
    return { startDate: w.startDate, endDate: new Date(w.end.getTime() - 12 * 3_600_000).toISOString().slice(0, 10) };
  });

  const [{ data: weekOrders }, { data: payoutRows }, { data: account }] = await Promise.all([
    // Money basis matches the Wave-1 payout logic: paid + keyed off delivered_at,
    // and catering counts too (its food value = total - fee - tip). (audit #8/#13)
    supabase
      .from("orders")
      .select("order_type, subtotal_mdl, total_mdl, delivery_fee_mdl, tip_mdl")
      .eq("restaurant_id", staffRow.restaurant_id)
      .eq("status", "delivered")
      .eq("payment_status", "paid")
      .gte("delivered_at", weekStart.toISOString())
      .lt("delivered_at", weekEnd.toISOString()),
    supabase
      .from("payouts")
      .select("*")
      .eq("recipient_type", "restaurant")
      .eq("recipient_id", staffRow.restaurant_id)
      .order("created_at", { ascending: false }),
    supabase
      .from("payout_accounts")
      .select("iban, holder_name")
      .eq("recipient_type", "restaurant")
      .eq("recipient_id", staffRow.restaurant_id)
      .maybeSingle(),
  ]);

  const week = (weekOrders ?? []) as {
    order_type: string;
    subtotal_mdl: number;
    total_mdl: number;
    delivery_fee_mdl: number;
    tip_mdl: number;
  }[];
  const weekCount = week.length;
  // Restaurant food value: standard → subtotal; catering → total - fee - tip
  // (the quoted food/service charge), matching admin_generate_payouts.
  const weekGross = round2(
    week.reduce(
      (s, o) =>
        s +
        (o.order_type === "standard"
          ? Number(o.subtotal_mdl)
          : Math.max(Number(o.total_mdl) - Number(o.delivery_fee_mdl) - Number(o.tip_mdl ?? 0), 0)),
      0,
    ),
  );
  const payouts = (payoutRows ?? []) as Payout[];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <h1 className="pg-gold-text font-serif text-2xl font-bold">Câștiguri</h1>
      <p className="mb-6 mt-1 text-sm text-white/50">Vânzările tale și decontările săptămânale.</p>

      <PremiumReveal as="section" className="pg-card pg-shimmer mb-8 rounded-2xl p-5">
        <p className="text-sm text-white/50">Vânzări brute · săptămâna aceasta</p>
        <p className="pg-gold-text pg-gold-text--live mt-2 text-3xl font-bold">{weekGross} MDL</p>
        <p className="mt-1 text-sm text-white/50">
          {weekCount} {weekCount === 1 ? "comandă livrată" : "comenzi livrate"} · înainte de comisionul platformei
        </p>
      </PremiumReveal>

      <PayoutAccountForm current={account} />

      <div className="mb-8 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-white/55">Raport vânzări (CSV, Excel):</span>
        {exportWeeks.map((w, i) => (
          <a
            key={w.startDate}
            href={`/restaurant/earnings/export?week=${w.startDate}`}
            className="min-h-11 content-center rounded-full bg-white/5 px-3.5 text-xs text-white/75 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            {i === 0 ? "Săptămâna curentă" : `${fmtDate(w.startDate)} – ${fmtDate(w.endDate)}`}
          </a>
        ))}
      </div>

      <h2 className="pg-gold-text mb-3 text-sm font-semibold uppercase tracking-wide">Plăți</h2>
      {payouts.length === 0 ? (
        <div className="pg-card rounded-2xl px-4 py-10 text-center text-sm text-white/50">
          Nicio plată încă — apar aici după prima decontare.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {payouts.map((p, i) => (
            <PremiumReveal key={p.id} as="li" delay={i * 60} className="pg-card pg-card--hover rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-white">
                  {fmtDate(p.period_start)} – {fmtDate(p.period_end)}
                </p>
                <PayoutStatusBadge status={p.status} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-white/40">Comenzi</p>
                  <p className="mt-0.5 font-medium text-white">{p.orders_count}</p>
                </div>
                <div>
                  <p className="text-xs text-white/40">Brut</p>
                  <p className="mt-0.5 font-medium text-white">{p.gross_mdl} MDL</p>
                </div>
                <div>
                  <p className="text-xs text-white/40">Comision</p>
                  <p className="mt-0.5 font-medium text-white/70">−{p.commission_mdl} MDL</p>
                </div>
                <div>
                  <p className="text-xs text-white/40">Net</p>
                  <p className="pg-gold-text mt-0.5 text-lg font-bold">{p.net_mdl} MDL</p>
                </div>
              </div>
            </PremiumReveal>
          ))}
        </ul>
      )}
    </main>
  );
}
