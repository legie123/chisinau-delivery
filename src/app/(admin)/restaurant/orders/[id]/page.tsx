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
} from "@/lib/types/domain";

const ACTOR_LABEL: Record<string, string> = {
  customer: "Client",
  restaurant_partner: "Restaurant",
  courier: "Curier",
  platform_admin: "Admin",
  system: "Sistem",
};

const formatDateTime = new Intl.DateTimeFormat("ro-RO", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Chisinau",
});

// Restaurant-side single-order view — the kitchen's full picture: every line
// item with its chosen modifiers and per-item notes, plus the status timeline.
// RLS (orders_partner_scope / *_scoped_read) restricts every read to the
// caller's own restaurant, so an order id that isn't theirs simply notFound()s.
// Deliberately no customer PII / delivery address (the courier handles delivery)
// and no payment internals (admin-only) — this is a cooking worklist.
export default async function RestaurantOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: order }, { data: items }, { data: events }, { data: catering }] = await Promise.all([
    supabase.from("orders").select("*").eq("id", id).eq("order_type", "standard").maybeSingle(),
    supabase.from("order_items").select("*").eq("order_id", id).order("id"),
    supabase.from("delivery_status_events").select("*").eq("order_id", id).order("created_at", { ascending: true }),
    supabase.from("catering_details").select("*").eq("order_id", id).maybeSingle(),
  ]);

  // Standard order not found under RLS → maybe it's a catering order; try that.
  let o = order as Order | null;
  if (!o) {
    const { data: cateringOrder } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
    o = cateringOrder as Order | null;
  }
  if (!o) notFound();

  const orderItems = (items ?? []) as unknown as OrderItem[];
  const timeline = (events ?? []) as DeliveryStatusEvent[];
  const cateringDetails = catering as CateringDetails | null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <div className="mb-1">
        <Link href="/restaurant/orders" className="text-xs text-white/50 transition hover:text-gold hover:underline">
          ← Înapoi la comenzi
        </Link>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-white">Comanda {o.order_number}</h1>
        <span className="rounded-full bg-white/5 px-3 py-1 text-sm font-normal text-white/70 ring-1 ring-white/10">
          {ORDER_STATUS_LABEL[o.status]}
        </span>
        {o.order_type === "catering" && (
          <span className="rounded-full bg-gold/15 px-3 py-1 text-sm font-medium text-gold ring-1 ring-gold/25">
            Catering
          </span>
        )}
      </div>

      {cateringDetails && (
        <section className="mb-5 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Eveniment</h2>
          <dl className="grid grid-cols-1 gap-y-1.5 text-sm sm:grid-cols-2">
            <Row label="Data" value={cateringDetails.event_date} />
            <Row label="Invitați" value={String(cateringDetails.guest_count)} />
            <Row label="Adresă" value={cateringDetails.event_address_text} />
            <Row label="Contact" value={`${cateringDetails.contact_person} · ${cateringDetails.contact_phone}`} />
          </dl>
        </section>
      )}

      <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">De pregătit</h2>
          <span className="text-sm text-white/60">
            Plată: {PAYMENT_METHOD_LABEL[o.payment_method]} · <span className="font-semibold text-white/85">{o.total_mdl} MDL</span>
          </span>
        </div>
        {orderItems.length === 0 ? (
          <p className="text-sm text-white/45">Niciun produs.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {orderItems.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 border-b border-white/[0.06] pb-3 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-white/90">
                    <span className="font-semibold text-white">{item.quantity}×</span> {item.item_name_snapshot}
                  </span>
                  <span className="shrink-0 text-white/45">{item.line_total_mdl} MDL</span>
                </div>
                {item.selected_options?.length > 0 && (
                  <ul className="pl-5 text-xs text-white/55">
                    {item.selected_options.map((opt, i) => (
                      <li key={i}>
                        + {opt.name}
                        {opt.price_delta_mdl ? ` (${opt.price_delta_mdl} MDL)` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {item.notes && <p className="pl-5 text-xs italic text-gold/80">„{item.notes}”</p>}
              </li>
            ))}
          </ul>
        )}
        {o.notes && (
          <p className="mt-4 rounded-xl bg-gold/10 px-3 py-2 text-sm text-gold/90 ring-1 ring-gold/20">
            Note client: {o.notes}
          </p>
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
                    <span className="ml-2 text-xs font-normal text-white/45">{ACTOR_LABEL[ev.actor_role] ?? ev.actor_role}</span>
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
