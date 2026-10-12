import { describe, expect, it } from "vitest";
import { exportLinesCsv } from "@/lib/payouts/bankCsv";

// The bank file is rendered from the FROZEN export batch (payout_export_lines, 20261012000411), not
// recomputed at download: what the bank receives is exactly what admin_settle_export_line marks paid.
describe("exportLinesCsv", () => {
  const line = {
    recipient_type: "restaurant" as const,
    recipient_id: "r1",
    name: "Sakura",
    iban: "MD24AG000225100013104168",
    holder_name: "Sakura SRL",
    net_mdl: 240,
    payout_ids: ["3f2a9c1e-aaaa", "b"],
  };

  it("one line per batch line, amount = the frozen net, reference names the batch", () => {
    const csv = exportLinesCsv("9e1f0c2a-1111-2222-3333-444455556666", [line, { ...line, recipient_id: "c1", recipient_type: "courier", net_mdl: 51.5, name: "Ion", holder_name: "Ion" }]);
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toBe("IBAN,Beneficiar,Suma,Moneda,Referinta");
    expect(rows[1]).toBe('MD24AG000225100013104168,"Sakura SRL",240.00,MDL,"Plata restaurant lot 9e1f0c2a (2 plăți)"');
    expect(rows[2]).toContain(",51.50,MDL,");
  });

  it("neutralizes formulas and strips control characters in names", () => {
    const csv = exportLinesCsv("9e1f0c2a", [{ ...line, holder_name: "\n=cmd|' /C calc'!A0" }]);
    expect(csv.split("\r\n")[1]).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(csv.split("\r\n")[1]).not.toMatch(/[\x00-\x1f]/);
  });
});
