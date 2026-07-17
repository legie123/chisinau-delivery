import { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/time";
import type { Payout } from "@/lib/types/domain";

// "Câștiguri" — the courier's own money view: this-week delivery earnings
// (delivery fee + tips over the last 7 delivered days) and the weekly payout
// history the platform settles to them. RLS scopes payouts to their own rows.
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

  const weekAgo = daysAgoIso(7);

  const [{ data: weekOrders }, { data: payoutRows }] = await Promise.all([
    supabase
      .from("orders")
      .select("delivery_fee_mdl, tip_mdl")
      .eq("courier_id", courier.id)
      .eq("status", "delivered")
      .gte("created_at", weekAgo),
    supabase
      .from("payouts")
      .select("*")
      .eq("recipient_type", "courier")
      .eq("recipient_id", courier.id)
      .order("created_at", { ascending: false }),
  ]);

  const week = (weekOrders ?? []) as { delivery_fee_mdl: number; tip_mdl: number }[];
  const weekCount = week.length;
  const weekEarnings = round2(week.reduce((s, o) => s + Number(o.delivery_fee_mdl) + Number(o.tip_mdl), 0));
  const payouts = (payoutRows ?? []) as Payout[];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <h1 className="font-serif text-2xl font-bold text-white">Câștiguri</h1>
      <p className="mb-6 mt-1 text-sm text-white/50">Comisioanele tale de livrare și plățile săptămânale.</p>

      <section className="mb-8 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <p className="text-sm text-white/50">Săptămâna aceasta</p>
        <p className="mt-2 text-3xl font-bold text-gold">{weekEarnings} MDL</p>
        <p className="mt-1 text-sm text-white/50">
          {weekCount} {weekCount === 1 ? "livrare completată" : "livrări completate"} · taxă livrare + bacșiș
        </p>
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
