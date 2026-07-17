import { createClient } from "@/lib/supabase/server";
import type { Payout } from "@/lib/types/domain";
import { GeneratePayoutsForm } from "@/components/admin/GeneratePayoutsForm";
import { PayoutMarkPaidButton } from "@/components/admin/PayoutMarkPaidButton";

// Platform payout console: commission rates, a generator for a chosen period,
// and the full ledger of every payout (courier + restaurant) with a
// mark-as-paid control on pending rows. RLS grants platform_admin read-all.
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" });

const round2 = (n: number) => Math.round(n * 100) / 100;

const RECIPIENT_LABEL: Record<Payout["recipient_type"], string> = {
  courier: "Curier",
  restaurant: "Restaurant",
};

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

export default async function PlatformPayoutsPage() {
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("platform_settings")
    .select("courier_commission_pct, restaurant_commission_pct")
    .maybeSingle();

  const { data: payoutRows } = await supabase
    .from("payouts")
    .select("*")
    .order("created_at", { ascending: false });
  const rows = (payoutRows ?? []) as Payout[];

  // Friendly recipient names via two lookups + a map (courier.full_name /
  // restaurant.name) — payouts store only recipient_id.
  const courierIds = [...new Set(rows.filter((r) => r.recipient_type === "courier").map((r) => r.recipient_id))];
  const restaurantIds = [...new Set(rows.filter((r) => r.recipient_type === "restaurant").map((r) => r.recipient_id))];

  const [{ data: couriers }, { data: restaurants }] = await Promise.all([
    supabase.from("couriers").select("id, full_name").in("id", courierIds),
    supabase.from("restaurants").select("id, name").in("id", restaurantIds),
  ]);

  const nameMap = new Map<string, string>();
  ((couriers ?? []) as { id: string; full_name: string }[]).forEach((c) => nameMap.set(c.id, c.full_name));
  ((restaurants ?? []) as { id: string; name: string }[]).forEach((r) => nameMap.set(r.id, r.name));

  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + Number(r.gross_mdl),
      commission: acc.commission + Number(r.commission_mdl),
      net: acc.net + Number(r.net_mdl),
    }),
    { gross: 0, commission: 0, net: 0 },
  );

  return (
    <main className="flex-1 px-6 py-8">
      <h1 className="mb-6 font-serif text-2xl font-bold text-white">Plăți</h1>

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
          <p className="text-sm text-white/50">Comision curieri</p>
          <p className="mt-1 text-2xl font-bold text-gold">{settings?.courier_commission_pct ?? 15}%</p>
        </div>
        <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
          <p className="text-sm text-white/50">Comision restaurante</p>
          <p className="mt-1 text-2xl font-bold text-gold">{settings?.restaurant_commission_pct ?? 20}%</p>
        </div>
      </section>

      <div className="mb-8">
        <GeneratePayoutsForm />
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/60">Toate plățile</h2>
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-white/[0.04] px-4 py-8 text-center text-sm text-white/50 ring-1 ring-white/[0.06]">
          Nicio plată generată încă. Alege o perioadă și apasă „Generează plăți”.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/50">
                <th className="py-2">Beneficiar</th>
                <th className="py-2">Tip</th>
                <th className="py-2">Perioadă</th>
                <th className="py-2 text-right">Comenzi</th>
                <th className="py-2 text-right">Brut</th>
                <th className="py-2 text-right">Comision</th>
                <th className="py-2 text-right">Net</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Acțiune</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-white/5 align-top">
                  <td className="py-3 font-medium text-white">{nameMap.get(r.recipient_id) ?? "—"}</td>
                  <td className="py-3 text-white/60">{RECIPIENT_LABEL[r.recipient_type]}</td>
                  <td className="py-3 whitespace-nowrap text-white/70">
                    {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                  </td>
                  <td className="py-3 text-right text-white/70">{r.orders_count}</td>
                  <td className="py-3 text-right whitespace-nowrap text-white/70">{r.gross_mdl} MDL</td>
                  <td className="py-3 text-right whitespace-nowrap text-white/60">−{r.commission_mdl} MDL</td>
                  <td className="py-3 text-right whitespace-nowrap font-semibold text-gold">{r.net_mdl} MDL</td>
                  <td className="py-3">
                    <PayoutStatusBadge status={r.status} />
                  </td>
                  <td className="py-3 text-right">
                    {r.status === "pending" ? (
                      <PayoutMarkPaidButton payoutId={r.id} />
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 font-semibold text-white">
                <td className="py-3" colSpan={4}>
                  Total
                </td>
                <td className="py-3 text-right whitespace-nowrap">{round2(totals.gross)} MDL</td>
                <td className="py-3 text-right whitespace-nowrap text-white/70">−{round2(totals.commission)} MDL</td>
                <td className="py-3 text-right whitespace-nowrap text-gold">{round2(totals.net)} MDL</td>
                <td className="py-3" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </main>
  );
}
