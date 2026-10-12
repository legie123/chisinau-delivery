import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// Cash ledger (courier_cash_movements, append-only): how much cash each courier still holds and
// every movement behind it. Balances come from the SQL view admin_courier_cash_balances (same sum as
// courier_cash_balance()) — an app-side sum over a select would be cut at PostgREST's 1000 rows. Read-only — depositing goes through the courier page (record_cash_offload).
// RLS courier_cash_movements_admin_read limits this to platform_admin.

const KIND_LABEL: Record<string, string> = {
  collected: "încasat la livrare",
  offload: "predat",
  refund_reversal: "corecție rambursare",
};

const fmt = new Intl.DateTimeFormat("ro-MD", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Chisinau" });
const mdl = (n: number) => `${n.toLocaleString("ro-MD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MDL`;

type Movement = { id: string; courier_id: string; kind: string; amount_mdl: number | string; created_at: string; order_id: string | null; note: string | null };
type Balance = { courier_id: string; balance_mdl: number; collected_mdl: number; offloaded_mdl: number; other_mdl: number; last_at: string; movements: number };

export default async function PlatformCashPage({ searchParams }: { searchParams: Promise<{ courier?: string }> }) {
  const { courier } = await searchParams;
  const supabase = await createClient();
  const [{ data: balances, error }, { data: couriers }] = await Promise.all([
    supabase.from("admin_courier_cash_balances").select("*").order("balance_mdl", { ascending: false }),
    supabase.from("couriers").select("id, full_name"),
  ]);
  const name = new Map((couriers ?? []).map((c) => [c.id, c.full_name]));
  const summary = ((balances ?? []) as Balance[]).map((b) => ({
    courierId: b.courier_id, balance: Number(b.balance_mdl), collected: Number(b.collected_mdl),
    offloaded: Number(b.offloaded_mdl), other: Number(b.other_mdl), lastAt: b.last_at, movements: Number(b.movements),
  }));

  let movements: Movement[] = [];
  if (courier) {
    const { data } = await supabase
      .from("courier_cash_movements")
      .select("id, courier_id, kind, amount_mdl, created_at, order_id, note")
      .eq("courier_id", courier)
      .order("created_at", { ascending: false })
      .limit(100);
    movements = (data ?? []) as Movement[];
  }

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Registru cash</h1>
        <p className="text-sm text-white/50">Cât numerar are fiecare curier de predat: încasat la livrare − predat ± corecții. Registrul nu se editează; o greșeală se corectează cu o mișcare nouă.</p>
      </div>

      {error ? (
        <p className="rounded-xl bg-primary/10 p-4 text-sm text-primary">Registrul nu a putut fi citit. Încearcă din nou.</p>
      ) : summary.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.04] py-14 text-center text-white/60 ring-1 ring-white/[0.06]">Nicio mișcare de numerar încă.</div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-white/50">
            <tr><th className="py-2">Curier</th><th>De predat</th><th>Încasat</th><th>Predat</th><th>Corecții</th><th>Ultima mișcare</th><th /></tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.courierId} className={`border-t border-white/5 ${s.courierId === courier ? "bg-white/[0.04]" : ""}`}>
                <td className="py-2 font-medium text-white">{name.get(s.courierId) ?? s.courierId.slice(0, 8)}</td>
                <td className={s.balance > 0 ? "font-semibold text-gold" : "text-white/70"}>{mdl(s.balance)}</td>
                <td className="text-white/70">{mdl(s.collected)}</td>
                <td className="text-white/70">{mdl(s.offloaded)}</td>
                <td className="text-white/70">{mdl(s.other)}</td>
                <td className="text-white/50">{fmt.format(new Date(s.lastAt))}</td>
                <td><Link href={`/platform/cash?courier=${s.courierId}`} className="text-primary underline underline-offset-4">mișcări ({s.movements})</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {courier && (
        <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
          <h2 className="mb-3 font-medium text-white">Mișcări — {name.get(courier) ?? courier.slice(0, 8)}</h2>
          {movements.length === 0 ? (
            <p className="text-sm text-white/60">Nicio mișcare pentru acest curier.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-white/50"><tr><th className="py-1">Când</th><th>Tip</th><th>Sumă</th><th>Comandă</th><th>Notă</th></tr></thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-t border-white/5">
                    <td className="py-1.5 text-white/60">{fmt.format(new Date(m.created_at))}</td>
                    <td>{KIND_LABEL[m.kind] ?? m.kind}</td>
                    <td className={Number(m.amount_mdl) < 0 ? "text-emerald-300" : "text-gold"}>{mdl(Number(m.amount_mdl))}</td>
                    <td>{m.order_id ? <Link href={`/platform/orders/${m.order_id}`} className="text-primary underline underline-offset-4">{m.order_id.slice(0, 8)}</Link> : "—"}</td>
                    <td className="text-white/60">{m.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}
