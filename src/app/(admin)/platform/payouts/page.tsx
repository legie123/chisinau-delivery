import { createClient } from "@/lib/supabase/server";
import type { Payout } from "@/lib/types/domain";
import { GeneratePayoutsForm } from "@/components/admin/GeneratePayoutsForm";
import { SettlePayeeButton } from "@/components/admin/SettlePayeeButton";
import { buildPayoutBankCsv } from "@/lib/payouts/bankCsv";
import { loadPendingBankRows } from "@/lib/payouts/pendingBankRows";

// Platform payout console: commission rates, a generator for a chosen period,
// and the full ledger of every payout (courier + restaurant) with a
// mark-as-paid control on pending rows. RLS grants platform_admin read-all.
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" });

const round2 = (n: number) => Math.round(n * 100) / 100;
// Signed MDL — avoids the "−-200" double-minus and shows clawbacks (negative rows)
// with an explicit sign. (audit #12)
const signedMdl = (n: number) => `${n < 0 ? "−" : ""}${round2(Math.abs(n))} MDL`;
// A commission line is shown as a deduction; for a clawback it's a positive
// give-back, so flip the displayed sign consistently with the net.
const deductionMdl = (n: number) => `${n >= 0 ? "−" : "+"}${round2(Math.abs(n))} MDL`;

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

  // The version in effect NOW (what payouts apply), not platform_settings: set_pricing_config
  // writes that cache at once, so a rate scheduled for next week showed as current.
  const { data: pricing } = await supabase.rpc("current_pricing_config");
  const settings = pricing as { courier_commission_pct: number; restaurant_commission_pct: number } | null;

  const { data: payoutRows } = await supabase
    .from("payouts")
    .select("*")
    .order("created_at", { ascending: false });
  const rows = (payoutRows ?? []) as Payout[];
  const bank = buildPayoutBankCsv(await loadPendingBankRows(supabase));

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
      <h1 className="mb-3 font-serif text-2xl font-bold text-white">Plăți</h1>

      {/* Manual bookkeeping notice — the pilot has no bank/PSP integration. These
          controls only RECORD money you move by hand (transfer bancar / cash);
          apăsarea „Marchează plătit” nu trimite niciun ban automat. */}
      <p className="mb-6 rounded-xl bg-gold/10 px-4 py-3 text-sm text-gold/90 ring-1 ring-gold/20">
        📒 Evidență manuală: aceste plăți se fac în afara platformei (transfer bancar / numerar).
        „Marchează plătit” doar înregistrează că ai efectuat plata — nu mișcă niciun ban automat.
      </p>

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

      <section className="mb-8 flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <a
          href="/platform/payouts/export"
          className="rounded-xl bg-gold px-4 py-2 text-sm font-semibold text-black hover:bg-gold/90"
        >
          Exportă CSV pentru bancă
        </a>
        <p className="text-sm text-white/60">
          {bank.exported} transferuri în așteptare · {round2(bank.totalMdl)} MDL
          {bank.skippedNonPositive > 0 && ` · ${bank.skippedNonPositive} recuperări excluse`}
        </p>
        {bank.payees.filter((p) => p.net > 0).length > 0 && (
          <ul className="w-full divide-y divide-white/5">
            {bank.payees
              .filter((p) => p.net > 0)
              .map((p) => (
                <li key={`${p.recipient_type}:${p.recipient_id}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-white">
                    {p.name} <span className="text-white/40">· {RECIPIENT_LABEL[p.recipient_type]} · {p.rows} plăți</span>
                    {!p.hasIban && <span className="ml-2 text-gold">fără IBAN</span>}
                  </span>
                  <SettlePayeeButton recipientType={p.recipient_type} recipientId={p.recipient_id} netMdl={p.net} />
                </li>
              ))}
          </ul>
        )}
        {bank.missingIban.length > 0 && (
          <p className="w-full text-sm text-gold/90">
            Fără IBAN (nu intră în fișier): {bank.missingIban.join(", ")}
          </p>
        )}
      </section>

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
              {rows.map((r) => {
                  // A clawback (refund reversal) is a negative payout: recover money,
                  // not pay it. Render it distinctly instead of as gold earnings.
                  const isClawback = Number(r.net_mdl) < 0;
                  return (
                    <tr key={r.id} className="border-b border-white/5 align-top">
                      <td className="py-3 font-medium text-white">
                        {nameMap.get(r.recipient_id) ?? "—"}
                        {isClawback && (
                          <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-red-300">
                            Recuperare
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-white/60">{RECIPIENT_LABEL[r.recipient_type]}</td>
                      <td className="py-3 whitespace-nowrap text-white/70">
                        {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                      </td>
                      <td className="py-3 text-right text-white/70">{r.orders_count}</td>
                      <td className="py-3 text-right whitespace-nowrap text-white/70">{signedMdl(Number(r.gross_mdl))}</td>
                      <td className="py-3 text-right whitespace-nowrap text-white/60">{deductionMdl(Number(r.commission_mdl))}</td>
                      <td className={`py-3 text-right whitespace-nowrap font-semibold ${isClawback ? "text-red-300" : "text-gold"}`}>
                        {signedMdl(Number(r.net_mdl))}
                      </td>
                      <td className="py-3">
                        <PayoutStatusBadge status={r.status} />
                      </td>
                      <td className="py-3 text-right">
                        {r.status === "pending" ? (
                          <span className="text-xs text-white/40">pe beneficiar ↑</span>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
