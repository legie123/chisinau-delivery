// Bank transfer list: ONE line per payee = the payee's NET pending balance (positive payouts minus
// pending clawbacks), amounts in MDL with two decimals. Paying per payout row skipped the negative
// clawback and sent the positive row whole (red-team on fac9997: +105.50 MDL); the admin settles the
// same net with admin_settle_payee (20261012000409), which refuses if the balance moved since export.
// ponytail: generic CSV (IBAN, name, amount, currency, reference); switch to the receiving bank's
// batch-import format once the user picks the bank and sends a sample file.
export interface BankCsvPayout {
  id: string;
  recipient_type: "courier" | "restaurant";
  recipient_id: string;
  period_start: string;
  period_end: string;
  net_mdl: number;
  name: string;
  iban: string | null;
  holder_name: string | null;
  /** Last IBAN change in the last 7 days (payout_account_changes), else null. */
  iban_changed_at: string | null;
}

export interface BankPayee {
  recipient_type: "courier" | "restaurant";
  recipient_id: string;
  name: string;
  /** Net pending balance in MDL (may be <= 0: nothing to send, recovered from later payouts). */
  net: number;
  rows: number;
  hasIban: boolean;
  /** IBAN changed recently: confirm with the payee before sending money (red-team on 9c2e8db). */
  ibanChangedAt: string | null;
}

export interface BankCsvResult {
  csv: string;
  exported: number;
  totalMdl: number;
  payees: BankPayee[];
  /** Payees with a positive net but no IBAN on file — paid by hand or after they add one. */
  missingIban: string[];
  /** Payees whose net is <= 0: a clawback larger than what they are owed; carried, not sent. */
  skippedNonPositive: number;
}

const TYPE_LABEL = { courier: "curier", restaurant: "restaurant" } as const;

// Every text field quoted (RFC 4180), control characters removed (a newline inside a name would start
// a new CSV record), and a leading =,+,-,@ neutralized so a spreadsheet never runs a name as a formula.
function cell(v: string): string {
  const clean = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const safe = /^[=+\-@]/.test(clean) ? `'${clean}` : clean;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildPayoutBankCsv(rows: BankCsvPayout[]): BankCsvResult {
  const byPayee = new Map<string, { payee: BankPayee; bani: number; first: BankCsvPayout; from: string; to: string; holder: string | null; iban: string | null }>();
  for (const r of rows) {
    const key = `${r.recipient_type}:${r.recipient_id}`;
    const bani = Math.round(Number(r.net_mdl) * 100);
    const g = byPayee.get(key);
    if (!g) {
      byPayee.set(key, {
        payee: { recipient_type: r.recipient_type, recipient_id: r.recipient_id, name: r.name, net: 0, rows: 1, hasIban: !!r.iban, ibanChangedAt: r.iban_changed_at },
        bani,
        first: r,
        from: r.period_start,
        to: r.period_end,
        holder: r.holder_name,
        iban: r.iban,
      });
    } else {
      g.bani += bani;
      g.payee.rows += 1;
      if (r.iban_changed_at && (!g.payee.ibanChangedAt || r.iban_changed_at > g.payee.ibanChangedAt)) g.payee.ibanChangedAt = r.iban_changed_at;
      if (r.period_start < g.from) g.from = r.period_start;
      if (r.period_end > g.to) g.to = r.period_end;
    }
  }

  const lines = ["IBAN,Beneficiar,Suma,Moneda,Referinta"];
  const missingIban: string[] = [];
  const payees: BankPayee[] = [];
  let skippedNonPositive = 0;
  let totalBani = 0;

  for (const g of byPayee.values()) {
    g.payee.net = g.bani / 100;
    payees.push(g.payee);
    if (g.bani <= 0) {
      skippedNonPositive++;
      continue;
    }
    if (!g.iban) {
      missingIban.push(g.payee.name);
      continue;
    }
    totalBani += g.bani;
    const ref = `Plata ${TYPE_LABEL[g.payee.recipient_type]} ${g.from}..${g.to} ${g.first.id.slice(0, 8)}`;
    lines.push([g.iban, cell(g.holder || g.payee.name), (g.bani / 100).toFixed(2), "MDL", cell(ref)].join(","));
  }

  return {
    csv: lines.join("\r\n") + "\r\n",
    exported: lines.length - 1,
    totalMdl: totalBani / 100,
    payees,
    missingIban,
    skippedNonPositive,
  };
}
