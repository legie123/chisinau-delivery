import { createClient } from "@/lib/supabase/server";
import { currentWeekRange, summarizeEarnings, type EarningsOrder } from "@/app/(courier)/_lib/earnings";
import type { Payout } from "@/lib/types/domain";

// "Câștiguri" — the courier's own money view: #3b canonical model — net after
// commission, tips included, scoped to the current calendar week (same Mon-Sun
// boundary payout periods use) — plus the weekly payout history the platform
// has actually settled to them. RLS scopes payouts to their own rows.
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" });

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

export default async function CourierEarningsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: courier } = await supabase
    .from("couriers")
    .select("id")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  if (!courier) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16 text-center">
        <p className="text-white/60">Contul tău nu este înregistrat ca curier.</p>
      </main>
    );
  }

  const { start: weekStart, end: weekEnd } = currentWeekRange();

  const [{ data: weekOrders }, { data: payoutRows }] = await Promise.all([
    supabase
      .from("orders")
      .select("delivery_fee_mdl, tip_mdl, payment_status")
      .eq("courier_id", courier.id)
      .eq("status", "delivered")
      .gte("delivered_at", weekStart.toISOString())
      .lt("delivered_at", weekEnd.toISOString()),
    supabase
      .from("payouts")
      .select("*")
      .eq("recipient_type", "courier")
      .eq("recipient_id", courier.id)
      .order("created_at", { ascending: false }),
  ]);

  const week = (weekOrders ?? []) as EarningsOrder[];
  const weekSummary = summarizeEarnings(week);
  const payouts = (payoutRows ?? []) as Payout[];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <h1 className="font-serif text-2xl font-bold text-white">Câștiguri</h1>
      <p className="mb-6 mt-1 text-sm text-white/50">Comisioanele tale de livrare și plățile săptămânale.</p>

      <section className="mb-8 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <p className="text-sm text-white/50">Săptămâna aceasta (net, după comision)</p>
        <p className="mt-2 text-3xl font-bold text-gold">{weekSummary.netMdl} MDL</p>
        <p className="mt-1 text-sm text-white/50">
          {weekSummary.ordersCount} {weekSummary.ordersCount === 1 ? "livrare încasată" : "livrări încasate"} · taxă livrare + bacșiș
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-white/40">Brut</p>
            <p className="mt-0.5 font-medium text-white">{weekSummary.grossMdl} MDL</p>
          </div>
          <div>
            <p className="text-xs text-white/40">Comision</p>
            <p className="mt-0.5 font-medium text-white/70">−{weekSummary.commissionMdl} MDL</p>
          </div>
          <div>
            <p className="text-xs text-white/40">Net</p>
            <p className="mt-0.5 font-semibold text-gold">{weekSummary.netMdl} MDL</p>
          </div>
        </div>
        {weekSummary.pendingCount > 0 && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300/90 ring-1 ring-amber-500/20">
            ⚠️ {weekSummary.pendingCount} {weekSummary.pendingCount === 1 ? "livrare neîncasată" : "livrări neîncasate"} nu apar
            aici — vezi Istoric.
          </p>
        )}
      </section>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/60">Plăți</h2>
      {payouts.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.04] px-4 py-10 text-center text-sm text-white/50 ring-1 ring-white/[0.06]">
          Nicio plată încă — apar aici după prima decontare.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {payouts.map((p) => (
            <li key={p.id} className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
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
                  <p className="mt-0.5 text-lg font-bold text-gold">{p.net_mdl} MDL</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
