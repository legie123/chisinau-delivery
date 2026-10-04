import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { createClient } from "@/lib/supabase/server";
import { getCourierCashStatus, getPublicPricingHistory } from "@chisinau/shared-api";
import { CourierCommandBar } from "@/components/courier/CourierCommandBar";
import { AvailableOrderRow } from "@/components/courier/AvailableOrderRow";
import { AvailableOrdersLive } from "@/components/courier/AvailableOrdersLive";
import { OfferCard } from "@/components/courier/OfferCard";
import { OffersLive } from "@/components/courier/OffersLive";
import { SatisfactionPrompt } from "@/components/courier/SatisfactionPrompt";
import { CashFloatStatus } from "@/components/courier/CashFloatStatus";
import { PushOptIn } from "@/components/shared/PushOptIn";
import { SectorBackdrop } from "@/components/immersive/SectorBackdrop";
import {
  COMMISSION_PCT,
  currentWeekRange,
  summarizeEarnings,
  todayStart,
  type EarningsOrder,
} from "@/app/(courier)/_lib/earnings";
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

  // Faza 5 #5 — săptămâna sondajului = lunea din calendarul Chișinăului, aceeași
  // cheie pe care submit_courier_satisfaction o scrie (nu toISOString(), care
  // dădea duminica precedentă pe un server în ora Chișinăului).
  const now = new Date();
  const { startDate: weekStartIso } = currentWeekRange(now);

  // Ziua curentă în ora Chișinăului — banii de azi sunt prima întrebare a
  // curierului, iar până acum nu se vedeau nicăieri pe ecranul principal.
  const dayStart = todayStart(now);

  const [{ data: activeOrders }, { data: availableOrders }, { data: liveOffer }, { data: survey }, cashStatus, { data: todayDone }, pricingHistory] =
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
      // Order 1 (pilot-critical) — cash float (balance vs. cap + offload text).
      getCourierCashStatus(supabase).catch(() => null),
      supabase
        .from("orders")
        .select("courier_fee_mdl, delivery_fee_mdl, tip_mdl, payment_status, delivered_at")
        .eq("courier_id", courier.id)
        .eq("status", "delivered")
        .gte("delivered_at", dayStart.toISOString()),
      // Comisionul fiecărei livrări = versiunea în vigoare la delivered_at, ca payout-ul.
      getPublicPricingHistory(supabase),
    ]);

  // Comisionul viu, o singură citire pentru tot ecranul: și cifra zilei, și
  // fiecare „Câștig" de pe ofertele de dedesubt. `current_pricing_config` e
  // SECURITY DEFINER cu EXECUTE pentru `authenticated` — probat sub
  // `set local role authenticated`, nu presupus (lecția sim 62).
  const { data: pricing } = await supabase.rpc("current_pricing_config");
  const commissionPct = (pricing as { courier_commission_pct: number } | null)?.courier_commission_pct ?? COMMISSION_PCT;

  const active = (activeOrders ?? []) as Order[];
  const available = (availableOrders ?? []) as Order[];
  const offer = (liveOffer as DispatchOffer | null) ?? null;
  const surveyAnswered = survey != null;

  // R8 — cifra zilei trece prin ACELAȘI model canonic ca `/earnings` și ca
  // payout-ul real (`summarizeEarnings`), nu printr-o reducere proprie. Cea
  // veche aduna brut și număra și livrările NEÎNCASATE — adică exact comenzile
  // pe care pagina de câștiguri le scoate din sumă și le anunță separat
  // („N livrări neîncasate nu apar aici"). Două formule pentru aceeași
  // întrebare au dat, previzibil, două răspunsuri: pe datele de azi ale
  // curierului de test, 118 MDL pe ecranul principal față de 71 MDL decontați.
  // Istoricul tarifelor dă comisionul fiecărei comenzi la delivered_at (ca
  // payout-ul); dacă citirea lui eșuează (vine []), rămâne rata vie.
  const todaySummary = summarizeEarnings(
    (todayDone ?? []) as EarningsOrder[],
    pricingHistory.length > 0 ? pricingHistory : commissionPct,
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      {/* Noaptea orașului în spatele barei de comandă (§3 al rubricii), la 8%.
          `ambient`, nu `hero`: ecranul ăsta e un instrument de lucru, nu o
          deschidere — atmosfera nu se retrage la scroll, fiindcă nu s-a impus
          niciodată. Sub el intră doar posterul, nu filmul de 4 MB de pe poarta
          curierului (vezi `ambientMedia` în `sectors.ts`). */}
      <SectorBackdrop sector="courier" intensity="ambient" />

      <AvailableOrdersLive />
      <OffersLive courierId={courier.id} />

      {/* Starea, banii și cursele — în ordinea în care le caută omul de pe stradă. */}
      <CourierCommandBar
        firstName={courier.full_name.split(" ")[0]}
        status={courier.status}
        earnedToday={Math.round(todaySummary.netMdl)}
        deliveriesToday={todaySummary.ordersCount}
        pendingToday={todaySummary.pendingCount}
        availableCount={available.length}
        hasActiveDelivery={active.length > 0}
      />

      {/* Oferta vie rămâne imediat sub bară: e singura care cere reacție în 30s. */}
      {offer && <OfferCard offer={offer} commissionPct={commissionPct} />}

      {/* Plafonul de numerar: important, dar nu primul lucru de dimineață. */}
      {cashStatus && <CashFloatStatus status={cashStatus} />}

      {active.length > 0 && (
        <section className="mb-7">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Livrarea ta activă</h2>
          {active.map((order) => (
            <Link
              key={order.id}
              href={`/deliveries/${order.id}`}
              // §3 al rubricii dă sectorului o lege de culoare: auriul e al
              // banilor, verdele al lui „online", roșul DOAR al lucrurilor
              // care îl costă acum. Cursa în desfășurare nu-l costă — e
              // venitul lui — dar era pictată în roșul de alarmă, aceeași
              // culoare ca avertismentul de plafon de numerar de deasupra.
              // Albastrul e limbajul pe care produsul îl folosea deja pentru
              // exact starea asta („În livrare", `OnlineToggle`), deci cardul
              // și pastila de stare spun acum același lucru în aceeași culoare.
              className="flex items-center justify-between gap-4 rounded-2xl bg-blue-600/90 p-5 text-white shadow-lg shadow-blue-900/40 transition hover:bg-blue-600"
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
            <BrandMark size="md" />
            <p className="text-white/60">{courier.status === "online" ? "Nimic momentan — te anunțăm imediat ce apare." : "Treci online ca să primești comenzi."}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {available.map((order) => (
              <AvailableOrderRow
                key={order.id}
                order={order}
                disabled={active.length > 0}
                commissionPct={commissionPct}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Coborâte sub fold: utile, dar nu sunt motivul pentru care deschide app-ul. */}
      <div className="mt-8 flex flex-col gap-4 border-t border-white/[0.07] pt-6">
        <PushOptIn />
        {!surveyAnswered && <SatisfactionPrompt />}
      </div>
    </main>
  );
}
