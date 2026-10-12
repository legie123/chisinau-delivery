import { describe, expect, it } from "vitest";
import { buildPayoutBankCsv, type BankCsvPayout } from "@/lib/payouts/bankCsv";

// W3: the admin exports one transfer per PAYEE = the payee's net pending balance (positive payouts
// minus pending clawbacks). Red-team on fac9997: per-row export skipped the negative clawback and sent
// the positive payout whole (+105.50 MDL). Payees without an IBAN and payees whose net is <= 0 are left
// out and reported, never silently dropped; the CSV total equals sum(net) of what it exports.
const row = (over: Partial<BankCsvPayout>): BankCsvPayout => ({
  id: "3f2a9c1e-0000-0000-0000-000000000000",
  recipient_type: "courier",
  recipient_id: "c1",
  period_start: "2026-10-05",
  period_end: "2026-10-11",
  net_mdl: 100,
  name: "Ion Curier",
  iban: "MD24AG000225100013104168",
  holder_name: "Ion Curier",
  iban_changed_at: null,
  ...over,
});

describe("buildPayoutBankCsv", () => {
  it("one line per payee; total equals the sum of the exported nets, to the ban", () => {
    const rows = [row({ net_mdl: 100.1 }), row({ id: "b", recipient_id: "c2", net_mdl: 200.2 }), row({ id: "c", recipient_id: "c3", net_mdl: 0.3 })];
    const r = buildPayoutBankCsv(rows);
    expect(r.exported).toBe(3);
    expect(r.totalMdl).toBe(300.6);
    const amounts = r.csv.trim().split("\r\n").slice(1).map((l) => Number(l.split(",")[2].replace(/"/g, "")));
    expect(Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(300.6);
  });

  it("a pending clawback is netted against the payee's positive payout (red-team: +105.50 overpaid)", () => {
    const rows = [
      row({ id: "p1", recipient_type: "restaurant", recipient_id: "r4", net_mdl: 344.25, name: "Rest D04" }),
      row({ id: "n1", recipient_type: "restaurant", recipient_id: "r4", net_mdl: -80, name: "Rest D04" }),
      row({ id: "p2", recipient_id: "c6", net_mdl: 51 }),
      row({ id: "n2", recipient_id: "c6", net_mdl: -25.5 }),
    ];
    const r = buildPayoutBankCsv(rows);
    expect(r.totalMdl).toBe(289.75); // 264.25 + 25.50
    expect(r.payees.find((p) => p.recipient_id === "r4")).toMatchObject({ net: 264.25, rows: 2 });
  });

  it("leaves out payees without an IBAN and payees whose net is not positive, and reports them", () => {
    const r = buildPayoutBankCsv([
      row({}),
      row({ id: "x", recipient_id: "c9", iban: null, name: "Fără Cont" }),
      row({ id: "y", recipient_id: "c8", net_mdl: -50 }),
    ]);
    expect(r.exported).toBe(1);
    expect(r.missingIban).toEqual(["Fără Cont"]);
    expect(r.skippedNonPositive).toBe(1);
    expect(r.totalMdl).toBe(100);
  });

  it("carries the most recent IBAN change to the payee, so the page can warn before paying", () => {
    const r = buildPayoutBankCsv([
      row({ id: "a", iban_changed_at: "2026-10-10T09:00:00Z" }),
      row({ id: "b", net_mdl: 5, iban_changed_at: "2026-10-11T09:00:00Z" }),
      row({ id: "c", recipient_id: "c2", iban_changed_at: null }),
    ]);
    expect(r.payees.find((p) => p.recipient_id === "c1")?.ibanChangedAt).toBe("2026-10-11T09:00:00Z");
    expect(r.payees.find((p) => p.recipient_id === "c2")?.ibanChangedAt).toBeNull();
  });

  it("writes a header, two decimals and a period reference", () => {
    const [header, line] = buildPayoutBankCsv([row({ net_mdl: 85 })]).csv.trim().split("\r\n");
    expect(header).toBe("IBAN,Beneficiar,Suma,Moneda,Referinta");
    expect(line).toBe('MD24AG000225100013104168,"Ion Curier",85.00,MDL,"Plata curier 2026-10-05..2026-10-11 3f2a9c1e"');
  });

  it("quotes every text field, strips control characters and neutralizes formulas", () => {
    const line = buildPayoutBankCsv([row({ holder_name: '\n=1+1;=cmd|\' /C calc\'!A0;' })]).csv.trim().split("\r\n")[1];
    expect(line.split(",")[0]).toBe("MD24AG000225100013104168");
    expect(line).not.toMatch(/[\x00-\x1f]/);
    expect(line).toContain(`"'=1+1;=cmd|' /C calc'!A0;"`);
  });
});
