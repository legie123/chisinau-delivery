import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankCsvPayout } from "./bankCsv";

// Pending payouts joined with the payee name and IBAN. RLS limits both tables to platform_admin
// (and the payee's own rows). Every read THROWS on error: a failed IBAN read used to show every
// payee as "Fără IBAN" and export an empty file (red-team on fac9997). Id lists go in chunks:
// ~250 uuids in one `in.(...)` filter exceed the URL limit (HTTP 414).
const CHUNK = 100;

async function inChunks<T>(ids: string[], read: (part: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) throw new Error("Nu am putut citi datele pentru plăți.");
    out.push(...(data ?? []));
  }
  return out;
}

export async function loadPendingBankRows(supabase: SupabaseClient): Promise<BankCsvPayout[]> {
  const { data: payouts, error } = await supabase
    .from("payouts")
    .select("id, recipient_type, recipient_id, period_start, period_end, net_mdl")
    .eq("status", "pending")
    .order("period_start", { ascending: true });
  if (error) throw new Error("Nu am putut citi plățile.");
  const rows = payouts ?? [];

  const ids = (t: string) => [...new Set(rows.filter((r) => r.recipient_type === t).map((r) => r.recipient_id as string))];
  const courierIds = ids("courier");
  const restaurantIds = ids("restaurant");
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [couriers, restaurants, accounts, changes] = await Promise.all([
    inChunks<{ id: string; full_name: string }>(courierIds, (part) => supabase.from("couriers").select("id, full_name").in("id", part)),
    inChunks<{ id: string; name: string }>(restaurantIds, (part) => supabase.from("restaurants").select("id, name").in("id", part)),
    inChunks<{ recipient_type: string; recipient_id: string; iban: string; holder_name: string }>(
      [...courierIds, ...restaurantIds],
      (part) => supabase.from("payout_accounts").select("recipient_type, recipient_id, iban, holder_name").in("recipient_id", part),
    ),
    // IBAN changes in the last 7 days, by ANY actor (payout_account_changes, 20261012000410).
    inChunks<{ recipient_type: string; recipient_id: string; changed_at: string }>(
      [...courierIds, ...restaurantIds],
      (part) =>
        supabase
          .from("payout_account_changes")
          .select("recipient_type, recipient_id, changed_at")
          .gt("changed_at", since)
          .in("recipient_id", part),
    ),
  ]);

  const names = new Map<string, string>();
  couriers.forEach((c) => names.set(`courier:${c.id}`, c.full_name));
  restaurants.forEach((r) => names.set(`restaurant:${r.id}`, r.name));
  const acc = new Map(accounts.map((a) => [`${a.recipient_type}:${a.recipient_id}`, a]));
  const changed = new Map<string, string>();
  for (const c of changes) {
    const key = `${c.recipient_type}:${c.recipient_id}`;
    if (!changed.has(key) || c.changed_at > changed.get(key)!) changed.set(key, c.changed_at);
  }

  return rows.map((r) => {
    const key = `${r.recipient_type}:${r.recipient_id}`;
    return {
      id: r.id,
      recipient_type: r.recipient_type,
      recipient_id: r.recipient_id,
      period_start: r.period_start,
      period_end: r.period_end,
      net_mdl: Number(r.net_mdl),
      name: names.get(key) ?? "—",
      iban: acc.get(key)?.iban ?? null,
      holder_name: acc.get(key)?.holder_name ?? null,
      iban_changed_at: changed.get(key) ?? null,
    };
  });
}
