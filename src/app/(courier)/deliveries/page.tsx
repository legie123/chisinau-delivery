import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { OnlineToggle } from "@/components/courier/OnlineToggle";
import { AvailableOrderRow } from "@/components/courier/AvailableOrderRow";
import { AvailableOrdersLive } from "@/components/courier/AvailableOrdersLive";
import { OfferCard } from "@/components/courier/OfferCard";
import { OffersLive } from "@/components/courier/OffersLive";
import { SatisfactionPrompt } from "@/components/courier/SatisfactionPrompt";
import { PushOptIn } from "@/components/shared/PushOptIn";
import { currentWeekRange } from "@/app/(courier)/_lib/earnings";
import { ORDER_STATUS_LABEL, type DispatchOffer, type Order } from "@/lib/types/domain";

export default async function DeliveriesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: courier } = await supabase
    .from("couriers")
    .select("*")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  if (!courier) {
    return (
      <main className="flex-1 px-5 py-16 text-center">
        <span className="text-5xl" aria-hidden>🛵</span>
        <p className="mt-3 text-white/60">Contul tău nu este înregistrat ca curier. Contactează un administrator.</p>
      </main>
    );
  }

  // Faza 5 #5 — same Mon-Sun boundary the earnings page + payout periods use.
  const weekStartIso = currentWeekRange().start.toISOString().slice(0, 10);

  const [{ data: activeOrders }, { data: availableOrders }, { data: liveOffer }, { data: survey }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("*")
        .eq("courier_id", courier.id)
        .in("status", ["courier_assigned", "picked_up", "en_route"]),
      supabase.from("orders").select("*").eq("status", "ready_for_pickup").is("courier_id", null).order("created_at"),
      // WS2 — the courier's single live push offer (RLS also scopes it to them).
      supabase
        .from("dispatch_offers")
        .select("*, orders(*)")
        .eq("courier_id", courier.id)
        .eq("status", "offered")
        .gt("expires_at", new Date().toISOString())
        .maybeSingle(),
      supabase
        .from("courier_satisfaction_surveys")
        .select("id")
        .eq("courier_id", courier.id)
        .eq("week_start", weekStartIso)
        .maybeSingle(),
    ]);

  const active = (activeOrders ?? []) as Order[];
  const available = (availableOrders ?? []) as Order[];
  const offer = (liveOffer as DispatchOffer | null) ?? null;
  const surveyAnswered = survey != null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <AvailableOrdersLive />
      <OffersLive courierId={courier.id} />

      {/* Web Push opt-in — so dispatch offers arrive even when the tab is backgrounded. */}
      <div className="mb-4">
        <PushOptIn />
      </div>

      {/* Faza 5 #5 — weekly satisfaction pulse; hidden once this week is answered. */}
      {!surveyAnswered && <SatisfactionPrompt />}

      {/* WS2 — push-dispatch offer takes the top slot when one is live. */}
      {offer && <OfferCard offer={offer} />}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Salut, {courier.full_name.split(" ")[0]} 👋</h1>
          <p className="mt-0.5 text-sm text-white/50">
            {available.length === 0 ? "Nicio comandă disponibilă acum" : `${available.length} comenzi disponibile`}
          </p>
        </div>
        <OnlineToggle initialStatus={courier.status} />
      </div>

      {active.length > 0 && (
        <section className="mb-7">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Livrarea ta activă</h2>
          {active.map((order) => (
            <Link
              key={order.id}
              href={`/deliveries/${order.id}`}
              className="flex items-center justify-between gap-4 rounded-2xl bg-primary-dark p-5 text-white shadow-lg shadow-primary/25 transition hover:bg-primary-darker"
            >
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-full bg-white/20 text-xl" aria-hidden>
                  🛵
                </span>
                <div>
                  <p className="font-bold">{order.order_number}</p>
                  <p className="text-sm text-white/80">{ORDER_STATUS_LABEL[order.status]}</p>
                </div>
              </div>
              <span className="text-sm font-semibold">Continuă →</span>
            </Link>
          ))}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Comenzi disponibile</h2>
        {/* #40 — a busy courier already has an active delivery; don't invite another accept. */}
        {active.length > 0 && (
          <p className="mb-3 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-400 ring-1 ring-amber-500/30">
            Finalizează livrarea curentă mai întâi.
          </p>
        )}
        {available.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] py-14 text-center ring-1 ring-white/[0.06]">
            <span className="text-5xl" aria-hidden>🧘</span>
            <p className="text-white/60">Nimic momentan — rămâi online, te anunțăm.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {available.map((order) => (
              <AvailableOrderRow key={order.id} order={order} disabled={active.length > 0} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
