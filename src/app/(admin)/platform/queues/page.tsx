import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  PAYMENT_METHOD_LABEL,
  type AdminPaymentQueueRow,
  type AdminStuckOrderRow,
} from "@/lib/types/domain";
import { StuckOrderActions } from "./StuckOrderActions";
import { PaymentActions } from "./PaymentActions";

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: "Neplătit",
  pending_capture: "În așteptare",
  paid: "Plătit",
  refund_pending: "Rambursare în curs",
  refunded: "Rambursat",
  failed: "Eșuat",
};

function ageLabel(seconds: number) {
  const mins = Math.floor(seconds / 60);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

export default async function PlatformQueuesPage() {
  const supabase = await createClient();
  const [{ data: stuck }, { data: payments }] = await Promise.all([
    supabase.from("admin_stuck_orders").select("*").order("in_state_seconds", { ascending: false }),
    supabase.from("admin_payment_queue").select("*").order("updated_at", { ascending: false }),
  ]);

  const stuckRows = (stuck ?? []) as AdminStuckOrderRow[];
  const payRows = (payments ?? []) as AdminPaymentQueueRow[];

  return (
    <main className="flex-1 px-6 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Cozi & dispute</h1>

      <section className="mb-10">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-white/60">
          Comenzi blocate
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">{stuckRows.length}</span>
        </h2>
        {stuckRows.length === 0 ? (
          <p className="rounded-2xl bg-white/[0.04] px-4 py-8 text-center text-sm text-white/50 ring-1 ring-white/[0.06]">
            Nicio comandă blocată. 🎉
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/50">
                  <th className="py-2">Comandă</th>
                  <th className="py-2">Motiv</th>
                  <th className="py-2">Vechime</th>
                  <th className="py-2">Restaurant</th>
                  <th className="py-2 text-right">Acțiune</th>
                </tr>
              </thead>
              <tbody>
                {stuckRows.map((o) => (
                  <tr key={o.id} className="border-b border-white/5 align-top">
                    <td className="py-3 font-medium text-white">
                      <Link href={`/platform/orders/${o.id}`} className="hover:text-gold hover:underline">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="py-3 text-white/70">{o.stuck_reason}</td>
                    <td className="py-3 text-primary">{ageLabel(o.in_state_seconds)}</td>
                    <td className="py-3 text-white/60">{o.restaurant_name}</td>
                    <td className="py-3 text-right">
                      <StuckOrderActions orderId={o.id} status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-white/60">
          Rambursări / dispute
          <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs text-gold">{payRows.length}</span>
        </h2>
        {payRows.length === 0 ? (
          <p className="rounded-2xl bg-white/[0.04] px-4 py-8 text-center text-sm text-white/50 ring-1 ring-white/[0.06]">
            Nicio dispută de plată deschisă.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/50">
                  <th className="py-2">Comandă</th>
                  <th className="py-2">Restaurant</th>
                  <th className="py-2">Sumă</th>
                  <th className="py-2">Metodă</th>
                  <th className="py-2">Stare plată</th>
                  <th className="py-2">Motiv</th>
                  <th className="py-2 text-right">Rezolvare</th>
                </tr>
              </thead>
              <tbody>
                {payRows.map((o) => (
                  <tr key={o.id} className="border-b border-white/5 align-top">
                    <td className="py-3 font-medium text-white">
                      <Link href={`/platform/orders/${o.id}`} className="hover:text-gold hover:underline">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="py-3 text-white/60">{o.restaurant_name}</td>
                    <td className="py-3 text-white/80">{o.total_mdl} MDL</td>
                    <td className="py-3 text-white/60">{PAYMENT_METHOD_LABEL[o.payment_method]}</td>
                    <td className="py-3">
                      <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
                        {PAYMENT_STATUS_LABEL[o.payment_status] ?? o.payment_status}
                      </span>
                    </td>
                    <td className="py-3 text-white/60">{o.cancellation_reason ?? "—"}</td>
                    <td className="py-3 text-right">
                      <PaymentActions orderId={o.id} status={o.payment_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
