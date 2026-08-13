import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SectionTabs, crmTabs } from "@/components/admin/SectionTabs";

type AdminCustomerRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  total_orders: number;
  delivered_orders: number;
  cancelled_orders: number;
  spent_mdl: number;
  last_order_at: string | null;
};

const formatDate = new Intl.DateTimeFormat("ro-RO", {
  dateStyle: "short",
  timeZone: "Europe/Chisinau",
});

// CRM — tabul Clienți (indexul secțiunii). Sursa: admin_customers
// (security_invoker + gate admin copt în view — sim 59). Restaurante/Curieri/
// Onboarding sunt aceleași pagini canonice de dinainte, legate prin tab-uri:
// aceleași tabele DB pentru toate rolurile = sincronizare implicită, fără copii.
export default async function PlatformCrmPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: rawQ } = await searchParams;
  const q = (rawQ ?? "").trim();

  const supabase = await createClient();

  let query = supabase.from("admin_customers").select("*");
  if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);
  const [{ data: customers, error }, { count: pendingOnboarding }] = await Promise.all([
    query.order("last_order_at", { ascending: false, nullsFirst: false }).limit(200),
    supabase
      .from("onboarding_applications")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const rows = (customers ?? []) as AdminCustomerRow[];

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">CRM</h1>
      <p className="mb-5 text-sm text-white/50">
        Toate conturile celor 3 sectoare, pe aceleași date vii din platformă.
      </p>
      <SectionTabs tabs={crmTabs(pendingOnboarding ?? 0)} current="/platform/crm" />

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Caută client
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="nume sau telefon"
            className="w-56 rounded-lg bg-white/5 px-3 py-2 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
          />
        </label>
        <button
          type="submit"
          className="rounded-full bg-primary-dark px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-darker"
        >
          Caută
        </button>
        {q && (
          <Link href="/platform/crm" className="text-sm text-white/50 underline underline-offset-4">
            Resetează
          </Link>
        )}
      </form>

      {error ? (
        <p className="text-red-400">Nu am putut încărca clienții: {error.message}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-white/[0.04] px-4 py-8 text-center text-sm text-white/50 ring-1 ring-white/[0.06]">
          Niciun client{q ? " găsit pentru căutare" : " încă"}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/50">
                <th className="py-2 pr-4">Client</th>
                <th className="py-2 pr-4">Telefon</th>
                <th className="py-2 pr-4">Comenzi (livrate/total)</th>
                <th className="py-2 pr-4">Anulate</th>
                <th className="py-2 pr-4">Valoare livrată</th>
                <th className="py-2 pr-4">Ultima comandă</th>
                <th className="py-2">Client din</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-white/5">
                  <td className="py-2.5 pr-4 font-medium text-white">{c.full_name ?? "—"}</td>
                  <td className="py-2.5 pr-4 text-white/70">{c.phone ?? "—"}</td>
                  <td className="py-2.5 pr-4 text-white/80">
                    <span className="font-semibold text-white">{c.delivered_orders}</span>
                    <span className="text-white/40"> / {c.total_orders}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    {c.cancelled_orders > 0 ? (
                      <span className="text-primary">{c.cancelled_orders}</span>
                    ) : (
                      <span className="text-white/35">0</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-gold">{c.spent_mdl} MDL</td>
                  <td className="py-2.5 pr-4 text-white/60">
                    {c.last_order_at ? formatDate.format(new Date(c.last_order_at)) : "—"}
                  </td>
                  <td className="py-2.5 text-white/45">{formatDate.format(new Date(c.created_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
