import { describe, expect, it } from "vitest";
import { buildPayoutBankCsv, type BankCsvPayout } from "@/lib/payouts/bankCsv";

// W3: the admin exports pending payouts as one transfer per line for the bank.
// The CSV total must equal sum(net) of the exported payouts; payees without an IBAN and
// clawbacks (net <= 0) are left out and reported, never silently dropped.
const row = (over: Partial<BankCsvPayout>): BankCsvPayout => ({
  id: "3f2a9c1e-0000-0000-0000-000000000000",
  recipient_type: "courier",
  period_start: "2026-10-05",
  period_end: "2026-10-11",
  net_mdl: 100,
  name: "Ion Curier",
  iban: "MD24AG000225100013104168",
  holder_name: "Ion Curier",
  ...over,
});

describe("buildPayoutBankCsv", () => {
  it("total equals sum(net) of the exported rows, to the ban", () => {
    const rows = [row({ net_mdl: 100.1 }), row({ id: "b", net_mdl: 200.2 }), row({ id: "c", net_mdl: 0.3 })];
    const r = buildPayoutBankCsv(rows);
    expect(r.exported).toBe(3);
    expect(r.totalMdl).toBe(300.6);
    const amounts = r.csv.trim().split("\r\n").slice(1).map((l) => Number(l.split(",")[2]));
    expect(Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(300.6);
  });

  it("leaves out payees without an IBAN and clawbacks, and reports them", () => {
    const r = buildPayoutBankCsv([row({}), row({ id: "x", iban: null, name: "Fără Cont" }), row({ id: "y", net_mdl: -50 })]);
    expect(r.exported).toBe(1);
    expect(r.missingIban).toEqual(["Fără Cont"]);
    expect(r.skippedNonPositive).toBe(1);
    expect(r.totalMdl).toBe(100);
  });

  it("writes a header, two decimals and a period reference", () => {
    const [header, line] = buildPayoutBankCsv([row({ net_mdl: 85 })]).csv.trim().split("\r\n");
    expect(header).toBe("IBAN,Beneficiar,Suma,Moneda,Referinta");
    expect(line).toBe("MD24AG000225100013104168,Ion Curier,85.00,MDL,Plata curier 2026-10-05..2026-10-11 3f2a9c1e");
  });

  it("quotes commas and neutralizes spreadsheet formulas in names", () => {
    const line = buildPayoutBankCsv([row({ holder_name: '=HYPERLINK("x"), SRL' })]).csv.trim().split("\r\n")[1];
    expect(line.split(",")[0]).toBe("MD24AG000225100013104168");
    expect(line).toContain(`"'=HYPERLINK(""x""), SRL"`);
  });
});
