import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  type CateringDetails,
  type DeliveryStatusEvent,
  type Order,
  type OrderItem,
  type PaymentStatus,
} from "@/lib/types/domain";
import { StuckOrderActions } from "../../queues/StuckOrderActions";
import { PaymentActions } from "../../queues/PaymentActions";

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Neîncasată",
  pending_capture: "În curs de încasare",
  paid: "Încasată",
  refund_pending: "Rambursare în curs",
  refunded: "Rambursată",
  failed: "Eșuată",
};

const ACTOR_LABEL: Record<string, string> = {
  customer: "Client",
  restaurant_partner: "Restaurant",
  courier: "Curier",
  platform_admin: "Admin",
  system: "Sistem",
};

type Embedded = Order & {
  restaurants: { name: string; phone: string } | null;
  couriers: { full_name: string; phone: string } | null;
};

const formatDateTime = new Intl.DateTimeFormat("ro-RO", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Europe/Chisinau",
});

// Single-order admin view — reached from stuck-order rows (queues) and fraud
// flag references, which used to dead-end at the flat /platform/orders list.
// Shows the full picture (restaurant/courier/customer/payment) plus the
// delivery_status_events audit trail, and offers the same admin actions
// (cancel / force-advance / resolve payment) available from the queues page.
export default async function PlatformOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: order }, { data: items }, { data: events }, { data: catering }] = await Promise.all([
    supabase
      .from("orders")
      .select("*, restaurants(name, phone), couriers(full_name, phone)")
      .eq("id", id)
      .single(),
    supabase.from("order_items").select("*").eq("order_id", id).order("id"),
    supabase.from("delivery_status_events").select("*").eq("order_id", id).order("created_at", { ascending: true }),
    supabase.from("catering_details").select("*").eq("order_id", id).maybeSingle(),
  ]);

  if (!order) notFound();

  const o = order as unknown as Embedded;

  let address: { street_address: string; sector: string | null; building: string | null; apartment: string | null } | null = null;
  if (o.delivery_address_id) {
    const { data: addr } = await supabase
      .from("addresses")
      .select("street_address, sector, building, apartment")
      .eq("id", o.delivery_address_id)
      .maybeSingle();
    address = addr;
  }

  let customer: { full_name: string; phone: string | null } | null = null;
  if (o.customer_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", o.customer_id)
      .maybeSingle();
    customer = profile;
  }

  const orderItems = (items ?? []) as unknown as OrderItem[];
  const timeline = (events ?? []) as DeliveryStatusEvent[];
  const cateringDetails = catering as CateringDetails | null;
  const isTerminal = o.status === "delivered" || o.status === "cancelled" || o.status === "rejected";

  return (
    <main className="flex-1 px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex gap-3 text-xs">
            <Link href="/platform/orders" className="text-white/50 hover:text-gold hover:underline">
              ← Toate comenzile
            </Link>
            <Link href="/platform/queues" className="text-white/50 hover:text-gold hover:underline">
              Cozi & dispute
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">
            Comanda {o.order_number}
            <span className="ml-3 rounded-full bg-white/5 px-3 py-1 text-sm font-normal text-white/70 ring-1 ring-white/10">
              {ORDER_STATUS_LABEL[o.status]}
            </span>
          </h1>
        </div>
        {!isTerminal && (
          <div className="flex flex-col items-end gap-2">
            <StuckOrderActions orderId={o.id} status={o.status} />
            <PaymentActions orderId={o.id} status={o.payment_status} />
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Detalii</h2>
          <dl className="grid grid-cols-1 gap-y-1.5 text-sm sm:grid-cols-2">
            <Row label="Tip" value={o.order_type === "catering" ? "Catering" : "Standard"} />
            <Row label="Creată" value={formatDateTime.format(new Date(o.created_at))} />
            <Row label="Restaurant" value={o.restaurants?.name ?? "—"} />
            <Row label="Tel. restaurant" value={o.restaurants?.phone ?? "—"} />
            <Row label="Client" value={customer?.full_name ?? "—"} />
            <Row label="Tel. client" value={customer?.phone ?? "—"} />
            <Row label="Curier" value={o.couriers?.full_name ?? "—"} />
            <Row label="Tel. curier" value={o.couriers?.phone ?? "—"} />
            <Row
              label="Adresă livrare"
              value={
                cateringDetails
                  ? cateringDetails.event_address_text
                  : address
                    ? [address.street_address, address.building, address.apartment, address.sector].filter(Boolean).join(", ")
                    : "—"
              }
            />
            {o.notes && <Row label="Note client" value={o.notes} />}
            {o.cancellation_reason && <Row label="Motiv anulare" value={o.cancellation_reason} />}
          </dl>
        </section>

        <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Plată & sumă</h2>
          <dl className="grid grid-cols-1 gap-y-1.5 text-sm sm:grid-cols-2">
            <Row label="Metodă" value={PAYMENT_METHOD_LABEL[o.payment_method]} />
            <Row label="Stare plată" value={PAYMENT_STATUS_LABEL[o.payment_status]} />
            <Row label="Subtotal" value={`${o.subtotal_mdl} MDL`} />
            <Row label="Taxă livrare" value={`${o.delivery_fee_mdl} MDL`} />
            <Row label="Bacșiș" value={`${o.tip_mdl} MDL`} />
            <Row label="Total" value={`${o.total_mdl} MDL`} />
          </dl>

          {cateringDetails && (
            <>
              <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wide text-white/50">Catering</h3>
              <dl className="grid grid-cols-1 gap-y-1.5 text-sm sm:grid-cols-2">
                <Row label="Data eveniment" value={cateringDetails.event_date} />
                <Row label="Persoane" value={String(cateringDetails.guest_count)} />
                <Row label="Contact" value={`${cateringDetails.contact_person} · ${cateringDetails.contact_phone}`} />
                <Row label="Stare ofertă" value={cateringDetails.quote_status} />
                {cateringDetails.quoted_total_mdl != null && (
                  <Row label="Ofertă" value={`${cateringDetails.quoted_total_mdl} MDL`} />
                )}
              </dl>
            </>
          )}
        </section>
      </div>

      <section className="mt-5 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Produse</h2>
        {orderItems.length === 0 ? (
          <p className="text-sm text-white/45">Niciun produs.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/50">
                  <th className="py-2">Produs</th>
                  <th className="py-2">Cantitate</th>
                  <th className="py-2">Preț</th>
                  <th className="py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {orderItems.map((item) => (
                  <tr key={item.id} className="border-b border-white/5">
                    <td className="py-2 pr-4">{item.item_name_snapshot}</td>
                    <td className="py-2 pr-4">{item.quantity}</td>
                    <td className="py-2 pr-4">{item.unit_price_mdl} MDL</td>
                    <td className="py-2">{item.line_total_mdl} MDL</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-5 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Istoric</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-white/45">Niciun eveniment înregistrat.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {timeline.map((ev) => (
              <li key={ev.id} className="flex items-start gap-3 border-l-2 border-gold/30 pl-3">
                <div>
                  <p className="text-sm font-medium text-white">
                    {ORDER_STATUS_LABEL[ev.status as keyof typeof ORDER_STATUS_LABEL] ?? ev.status}
                    <span className="ml-2 text-xs font-normal text-white/45">
                      {ACTOR_LABEL[ev.actor_role] ?? ev.actor_role}
                    </span>
                  </p>
                  {ev.note && <p className="text-xs text-white/55">{ev.note}</p>}
                  <p className="text-xs text-white/35">{formatDateTime.format(new Date(ev.created_at))}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-white/45">{label}</dt>
      <dd className="text-right text-white/85">{value}</dd>
    </div>
  );
}
