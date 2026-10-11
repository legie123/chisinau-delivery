import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankCsvPayout } from "./bankCsv";

// Pending payouts joined with the payee name and IBAN. RLS limits both tables to platform_admin
// (and the payee's own rows), so a non-admin client gets only what it may see anyway.
export async function loadPendingBankRows(supabase: SupabaseClient): Promise<BankCsvPayout[]> {
  const { data: payouts, error } = await supabase
    .from("payouts")
    .select("id, recipient_type, recipient_id, period_start, period_end, net_mdl")
    .eq("status", "pending")
    .order("period_start", { ascending: true });
  if (error) throw new Error("Nu am putut citi plățile.");
  const rows = payouts ?? [];

  const ids = (t: string) => [...new Set(rows.filter((r) => r.recipient_type === t).map((r) => r.recipient_id as string))];
  const [{ data: couriers }, { data: restaurants }, { data: accounts }] = await Promise.all([
    supabase.from("couriers").select("id, full_name").in("id", ids("courier")),
    supabase.from("restaurants").select("id, name").in("id", ids("restaurant")),
    supabase.from("payout_accounts").select("recipient_type, recipient_id, iban, holder_name").in("recipient_id", [
      ...ids("courier"),
      ...ids("restaurant"),
    ]),
  ]);

  const names = new Map<string, string>();
  (couriers ?? []).forEach((c) => names.set(`courier:${c.id}`, c.full_name));
  (restaurants ?? []).forEach((r) => names.set(`restaurant:${r.id}`, r.name));
  const acc = new Map((accounts ?? []).map((a) => [`${a.recipient_type}:${a.recipient_id}`, a]));

  return rows.map((r) => {
    const key = `${r.recipient_type}:${r.recipient_id}`;
    return {
      id: r.id,
      recipient_type: r.recipient_type,
      period_start: r.period_start,
      period_end: r.period_end,
      net_mdl: Number(r.net_mdl),
      name: names.get(key) ?? "—",
      iban: acc.get(key)?.iban ?? null,
      holder_name: acc.get(key)?.holder_name ?? null,
    };
  });
}
