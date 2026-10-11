// Bank transfer list for pending payouts: one line per payee, amounts in MDL with two decimals.
// ponytail: generic CSV (IBAN, name, amount, currency, reference); switch to the receiving bank's
// batch-import format once the user picks the bank and sends a sample file.
export interface BankCsvPayout {
  id: string;
  recipient_type: "courier" | "restaurant";
  period_start: string;
  period_end: string;
  net_mdl: number;
  name: string;
  iban: string | null;
  holder_name: string | null;
}

export interface BankCsvResult {
  csv: string;
  exported: number;
  totalMdl: number;
  /** Payees with a positive net but no IBAN on file — paid by hand or after they add one. */
  missingIban: string[];
  /** Clawbacks / zero rows: money to recover, not to send. */
  skippedNonPositive: number;
}

const TYPE_LABEL = { courier: "curier", restaurant: "restaurant" } as const;

// RFC 4180 quoting + a leading quote on =,+,-,@ so a spreadsheet never runs a name as a formula.
function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildPayoutBankCsv(rows: BankCsvPayout[]): BankCsvResult {
  const lines = ["IBAN,Beneficiar,Suma,Moneda,Referinta"];
  const missingIban: string[] = [];
  let skippedNonPositive = 0;
  let totalBani = 0;

  for (const r of rows) {
    const bani = Math.round(Number(r.net_mdl) * 100);
    if (bani <= 0) {
      skippedNonPositive++;
      continue;
    }
    if (!r.iban) {
      missingIban.push(r.name);
      continue;
    }
    totalBani += bani;
    const ref = `Plata ${TYPE_LABEL[r.recipient_type]} ${r.period_start}..${r.period_end} ${r.id.slice(0, 8)}`;
    lines.push([r.iban, cell(r.holder_name || r.name), (bani / 100).toFixed(2), "MDL", cell(ref)].join(","));
  }

  return {
    csv: lines.join("\r\n") + "\r\n",
    exported: lines.length - 1,
    totalMdl: totalBani / 100,
    missingIban,
    skippedNonPositive,
  };
}
