import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RELEASE_REASON_LABEL, currentVersion } from "@/lib/admin/courierSignals";
import { ReleasePolicyForm } from "./ReleasePolicyForm";

// Courier order releases ("Renunț la comandă", 20261012000209): the recent ones (who, which
// order, why, when) and the daily cap — a versioned, immutable policy shown like /platform/tarife
// (version in effect + history). RLS: platform_admin reads both tables; the cap is set via RPC.

type Release = {
  id: string;
  order_id: string;
  reason: string;
  created_at: string;
  couriers: { full_name: string } | null;
  orders: { order_number: string } | null;
};
type Policy = { id: string; effective_from: string; daily_cap: number; note: string | null };

const fmt = new Intl.DateTimeFormat("ro-MD", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Chisinau" });

export default async function PlatformRenuntariPage() {
  const supabase = await createClient();
  const [{ data: rel, error: re }, { data: pol, error: pe }] = await Promise.all([
    supabase
      .from("courier_order_releases")
      .select("id, order_id, reason, created_at, couriers(full_name), orders(order_number)")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("courier_release_policy").select("id, effective_from, daily_cap, note").order("effective_from", { ascending: false }).limit(20),
  ]);
  const releases = (rel ?? []) as unknown as Release[];
  const policies = (pol ?? []) as Policy[];
  const cur = currentVersion(policies);

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Renunțări curieri</h1>
        <p className="text-sm text-white/50">
          Comenzi lăsate de curier după preluare — se întorc în dispecerizare. Plafonul zilnic e provizoriu până la ratificarea fondatorului.
        </p>
      </div>

      {re || pe ? (
        <p className="rounded-xl bg-primary/10 p-4 text-sm text-primary">Renunțările nu au putut fi citite. Încearcă din nou.</p>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
              <p className="text-sm text-white/50">Plafon în vigoare</p>
              <p className="mt-1 text-2xl font-bold text-gold">{cur ? `${cur.daily_cap} / zi` : "—"}</p>
              {cur && <p className="mt-1 text-xs text-white/45">de la {fmt.format(new Date(cur.effective_from))}</p>}
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
              <p className="text-sm text-white/50">Renunțări (ultimele 100)</p>
              <p className="mt-1 text-2xl font-bold text-white">{releases.length}</p>
            </div>
          </section>

          <ReleasePolicyForm dailyCap={cur?.daily_cap ?? null} />

          <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
            <h2 className="mb-3 font-medium text-white">Istoric plafon</h2>
            <table className="w-full text-left text-sm">
              <thead className="text-white/50"><tr><th className="py-1">De la</th><th>Pe zi</th><th>Motiv</th><th /></tr></thead>
              <tbody>
                {policies.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="py-1.5">{fmt.format(new Date(r.effective_from))}</td>
                    <td>{r.daily_cap}</td>
                    <td className="text-white/60">{r.note ?? "—"}</td>
                    <td>
                      {cur && r.id === cur.id ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">în vigoare</span>
                      ) : (
                        <span className="text-xs text-white/40">istoric</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
            <h2 className="mb-3 font-medium text-white">Renunțări recente</h2>
            {releases.length === 0 ? (
              <p className="text-sm text-white/45">Nicio renunțare înregistrată.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-white/50"><tr><th className="py-1">Când</th><th>Curier</th><th>Comandă</th><th>Motiv</th></tr></thead>
                  <tbody>
                    {releases.map((r) => (
                      <tr key={r.id} className="border-t border-white/5">
                        <td className="py-1.5 whitespace-nowrap">{fmt.format(new Date(r.created_at))}</td>
                        <td>{r.couriers?.full_name ?? "—"}</td>
                        <td>
                          <Link href={`/platform/orders/${r.order_id}`} className="hover:text-gold hover:underline">
                            {r.orders?.order_number ?? r.order_id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="text-white/70">{RELEASE_REASON_LABEL[r.reason] ?? r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
