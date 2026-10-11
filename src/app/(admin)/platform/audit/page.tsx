import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SectionTabs, safetyTabs } from "@/components/admin/SectionTabs";
import { auditDiff } from "@/lib/admin/auditDiff";

// Who changed what, when — every admin intervention (migration 20261012000490_admin_audit_log).
// RLS admin_audit_log_admin_read limits this to platform_admin; the log is append-only and
// personal data in it is already masked ("***").

type AuditRow = {
  id: number;
  at: string;
  actor: string | null;
  actor_role: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  table_name: string;
  row_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
};

const TABLE_LABEL: Record<string, string> = {
  orders: "Comandă",
  restaurants: "Restaurant",
  restaurant_staff: "Personal restaurant",
  restaurant_hours: "Program",
  menu_items: "Produs",
  menu_categories: "Categorie meniu",
  menu_option_groups: "Grup opțiuni",
  menu_options: "Opțiune",
  couriers: "Curier",
  courier_suspensions: "Suspendare",
  courier_cash_movements: "Mișcare cash",
  dispatch_offers: "Ofertă curier",
  fraud_flags: "Semnalare",
  onboarding_applications: "Cerere înscriere",
  kyc_documents: "Document KYC",
  payouts: "Plată",
  payout_orders: "Linie plată",
  payout_accounts: "Cont bancar",
  payout_adjustments: "Ajustare plată",
  order_complaints: "Reclamație",
  ops_alerts: "Alertă",
  payment_intents: "Plată online",
  pricing_config: "Prețuri",
  courier_tariff_config: "Tarif curier",
  cash_policy: "Politică cash",
  dispatch_scoring_config: "Dispecerizare",
  platform_settings: "Setări platformă",
  profiles: "Rol utilizator",
  addresses: "Adresă",
  catering_details: "Catering",
  venue_bookings: "Rezervare",
};

const ACTION_LABEL = { INSERT: "a creat", UPDATE: "a modificat", DELETE: "a șters" } as const;

const fmt = new Intl.DateTimeFormat("ro-MD", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Chisinau" });

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; row?: string }>;
}) {
  const { table, row } = await searchParams;
  const supabase = await createClient();

  let query = supabase.from("admin_audit_log").select("*").order("id", { ascending: false }).limit(200);
  if (table && TABLE_LABEL[table]) query = query.eq("table_name", table);
  if (row) query = query.eq("row_id", row);
  const { data, error } = await query;
  const rows = (data ?? []) as AuditRow[];

  const actorIds = [...new Set(rows.map((r) => r.actor).filter((a): a is string => !!a))];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name ?? a.id.slice(0, 8)]));

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Siguranță</h1>
      <SectionTabs tabs={safetyTabs()} current="/platform/audit" />
      <p className="mb-4 text-sm text-white/50">
        Fiecare intervenție de admin: cine, ce, când, valoarea veche și cea nouă. Jurnalul nu poate fi modificat;
        datele personale apar ca ***.
      </p>

      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/platform/audit">
        <label className="flex flex-col gap-1">
          <span className="text-white/50">Tabel</span>
          <select name="table" defaultValue={table ?? ""} className="rounded-lg bg-white/[0.06] px-3 py-2 ring-1 ring-white/10">
            <option value="">Toate</option>
            {Object.entries(TABLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-white/50">ID rând</span>
          <input name="row" defaultValue={row ?? ""} className="rounded-lg bg-white/[0.06] px-3 py-2 ring-1 ring-white/10" />
        </label>
        <button type="submit" className="rounded-lg bg-primary px-4 py-2 font-semibold text-white">
          Filtrează
        </button>
      </form>

      {error ? (
        <p className="rounded-xl bg-primary/10 p-4 text-sm text-primary">Jurnalul nu a putut fi citit. Încearcă din nou.</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] py-14 text-center ring-1 ring-white/[0.06]">
          <span className="text-5xl" aria-hidden>📜</span>
          <p className="text-white/60">Nicio intervenție înregistrată pentru filtrul ales.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const who = r.actor ? (actorName.get(r.actor) ?? r.actor.slice(0, 8)) : "necunoscut";
            const label = TABLE_LABEL[r.table_name] ?? r.table_name;
            return (
              <li key={r.id} className="rounded-2xl bg-white/[0.04] p-4 text-sm ring-1 ring-white/[0.06]">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-white/50">{fmt.format(new Date(r.at))}</span>
                  <span className="font-semibold text-white">{who}</span>
                  {r.actor_role === "service_role" && <span className="text-xs text-white/40">(prin server)</span>}
                  <span className="text-white/70">{ACTION_LABEL[r.action]}</span>
                  <span className="text-white">{label}</span>
                  {r.row_id &&
                    (r.table_name === "orders" ? (
                      <Link href={`/platform/orders/${r.row_id}`} className="text-primary underline underline-offset-4">
                        {r.row_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <Link href={`/platform/audit?row=${r.row_id}`} className="text-white/40 underline underline-offset-4">
                        {r.row_id.slice(0, 8)}
                      </Link>
                    ))}
                </div>
                <dl className="mt-2 grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1">
                  {auditDiff(r.action, r.old_values, r.new_values).map((d) => (
                    <div key={d.key} className="contents">
                      <dt className="text-white/50">{d.key}</dt>
                      <dd className="break-all text-white/80">
                        {d.from !== null && <span className="text-white/40 line-through">{d.from}</span>}
                        {d.from !== null && d.to !== null && <span className="mx-1 text-white/30">→</span>}
                        {d.to !== null && <span>{d.to}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
