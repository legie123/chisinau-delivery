import { describe, expect, it } from "vitest";
import { foodValue, weekCsv, type CsvOrder } from "@/app/(admin)/restaurant/earnings/csv";

const std: CsvOrder = {
  order_number: "CHD-1",
  delivered_at: "2026-10-05T21:30:00Z", // Monday 00:30 in Chișinău
  order_type: "standard",
  payment_method: "cash",
  subtotal_mdl: 200,
  total_mdl: 260,
  delivery_fee_mdl: 40,
  tip_mdl: 20,
};
const cat: CsvOrder = { ...std, order_number: "CHD-2", order_type: "catering", payment_method: "online_gateway", total_mdl: 1550.5, delivery_fee_mdl: 50, tip_mdl: 0.25 };

describe("restaurant weekly CSV", () => {
  it("food value: subtotal for standard, total − fee − tip for catering", () => {
    expect(foodValue(std)).toBe(200);
    expect(foodValue(cat)).toBe(1500.25);
  });

  it("is Excel-RO shaped: BOM, ; separator, decimal comma, local time, total row", () => {
    const csv = weekCsv([std, cat]);
    expect(csv.startsWith("﻿Comanda;")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("CHD-1;06.10.2026, 00:30;livrare;cash;200,00");
    expect(lines[2].endsWith(";catering;plătit online;1500,25")).toBe(true);
    expect(lines[3]).toBe("TOTAL;;;2 comenzi;1700,25");
  });

  it("quotes cells that contain the separator", () => {
    expect(weekCsv([{ ...std, order_number: 'A;"B' }]).split("\r\n")[1].startsWith('"A;""B"')).toBe(true);
  });
});
