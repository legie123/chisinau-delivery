import { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/time";
import type { Payout } from "@/lib/types/domain";

// "Câștiguri" for the restaurant partner: this-week gross sales (subtotal of
// delivered standard orders in the last 7 days) plus the weekly payouts the
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

  const { data: staffRow } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  if (!staffRow) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16 text-center">
        <p className="text-white/60">Contul tău nu este asociat cu un restaurant.</p>
      </main>
    );
  }

  const weekAgo = daysAgoIso(7);

  const [{ data: weekOrders }, { data: payoutRows }] = await Promise.all([
    // Money basis matches the Wave-1 payout logic: paid + keyed off delivered_at,
    // and catering counts too (its food value = total - fee - tip). (audit #8/#13)
    supabase
      .from("orders")
      .select("order_type, subtotal_mdl, total_mdl, delivery_fee_mdl, tip_mdl")
      .eq("restaurant_id", staffRow.restaurant_id)
      .eq("status", "delivered")
      .eq("payment_status", "paid")
      .gte("delivered_at", weekAgo),
    supabase
      .from("payouts")
      .select("*")
      .eq("recipient_type", "restaurant")
      .eq("recipient_id", staffRow.restaurant_id)
      .order("created_at", { ascending: false }),
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
      <h1 className="font-serif text-2xl font-bold text-white">Câștiguri</h1>
      <p className="mb-6 mt-1 text-sm text-white/50">Vânzările tale și decontările săptămânale.</p>

      <section className="mb-8 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <p className="text-sm text-white/50">Vânzări brute · săptămâna aceasta</p>
        <p className="mt-2 text-3xl font-bold text-gold">{weekGross} MDL</p>
        <p className="mt-1 text-sm text-white/50">
          {weekCount} {weekCount === 1 ? "comandă livrată" : "comenzi livrate"} · înainte de comisionul platformei
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
