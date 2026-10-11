import { todayStart } from "@chisinau/shared-domain";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/types/domain";

// Weekly sales report for the partner, as CSV for Excel in Romanian locale:
// `;` separator, decimal comma, UTF-8 BOM. Food value matches the payout logic
// (standard → subtotal; catering → total − fee − tip).
export type CsvOrder = {
  order_number: string;
  delivered_at: string;
  order_type: string;
  payment_method: string;
  subtotal_mdl: number;
  total_mdl: number;
  delivery_fee_mdl: number;
  tip_mdl: number | null;
};

const when = new Intl.DateTimeFormat("ro-RO", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Chisinau" });

export function foodValue(o: CsvOrder): number {
  const v =
    o.order_type === "standard"
      ? Number(o.subtotal_mdl)
      : Math.max(Number(o.total_mdl) - Number(o.delivery_fee_mdl) - Number(o.tip_mdl ?? 0), 0);
  return Math.round(v * 100) / 100;
}

const money = (n: number) => n.toFixed(2).replace(".", ",");
const cell = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function weekCsv(orders: CsvOrder[]): string {
  const rows = [["Comanda", "Livrată la", "Tip", "Plată", "Valoare mâncare (MDL)"]];
  let total = 0;
  for (const o of orders) {
    const v = foodValue(o);
    total += v;
    rows.push([
      o.order_number,
      when.format(new Date(o.delivered_at)),
      o.order_type === "catering" ? "catering" : "livrare",
      PAYMENT_METHOD_LABEL[o.payment_method as PaymentMethod] ?? o.payment_method,
      money(v),
    ]);
  }
  rows.push(["TOTAL", "", "", `${orders.length} comenzi`, money(Math.round(total * 100) / 100)]);
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** One Chișinău calendar day "YYYY-MM-DD" as [start, end) instants. Anchored at noon so a
 *  DST day keeps its real length (25 Oct 2026 lasts 25 h), never start + 24 h. */
export function dayRange(day: string): { start: Date; end: Date } {
  const noon = Date.parse(`${day}T12:00:00Z`);
  return { start: todayStart(new Date(noon)), end: todayStart(new Date(noon + 86_400_000)) };
}
