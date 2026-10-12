import type { Order } from "@/lib/types/domain";

// The money row on the courier's delivery page. It used to read "De încasat" unconditionally, so a
// delivered, cancelled or already-paid-online order still told the courier to collect cash.
export function collectLine(o: Pick<Order, "status" | "payment_method" | "payment_status">): {
  label: string;
  owed: boolean;
} {
  if (o.status === "cancelled" || o.status === "rejected") return { label: "Anulată — nimic de încasat", owed: false };
  if (o.payment_method === "online_gateway") return { label: "Plătit online — nu încasa nimic", owed: false };
  const how = o.payment_method === "cash" ? "cash" : "card POS";
  if (o.status === "delivered") {
    return { label: `${o.payment_status === "paid" ? "Încasat" : "Neîncasat"} (${how})`, owed: false };
  }
  return { label: `De încasat (${how})`, owed: true };
}
