// Per-courier view of the append-only cash ledger (courier_cash_movements): how much cash each
// courier still holds (collected − offloaded ± corrections). Amounts may arrive as numeric strings.
export type LedgerRow = { courier_id: string; kind: string; amount_mdl: number | string; created_at: string };
export type LedgerSummary = {
  courierId: string;
  balance: number;
  collected: number;
  offloaded: number;
  other: number;
  lastAt: string;
  movements: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeLedger(rows: LedgerRow[]): LedgerSummary[] {
  const by = new Map<string, LedgerSummary>();
  for (const r of rows) {
    const amount = Number(r.amount_mdl);
    const s = by.get(r.courier_id) ?? { courierId: r.courier_id, balance: 0, collected: 0, offloaded: 0, other: 0, lastAt: r.created_at, movements: 0 };
    s.balance = round2(s.balance + amount);
    if (r.kind === "collected") s.collected = round2(s.collected + amount);
    else if (r.kind === "offload") s.offloaded = round2(s.offloaded + amount);
    else s.other = round2(s.other + amount);
    if (r.created_at > s.lastAt) s.lastAt = r.created_at;
    s.movements++;
    by.set(r.courier_id, s);
  }
  return [...by.values()].sort((a, b) => b.balance - a.balance);
}
