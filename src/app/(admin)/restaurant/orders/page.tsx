import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPrepEstimates } from "@chisinau/shared-api";
import { OrderQueueRow } from "@/components/admin/OrderQueueRow";
import { OrderQueueLive } from "@/components/admin/OrderQueueLive";
import { RestaurantPickupMap } from "@/components/admin/RestaurantPickupMap";
import { RestaurantWaitKpiChips } from "@/components/admin/RestaurantWaitKpiChips";
import { PushOptIn } from "@/components/shared/PushOptIn";
import { BusyModeControl } from "@/components/admin/BusyModeControl";
import type { Order, OrderItem, PrepEstimate, RestaurantWaitKpiRow } from "@/lib/types/domain";

const QUEUE_STATUSES = ["pending_restaurant", "accepted", "ready_for_pickup", "courier_assigned", "picked_up", "en_route"];

// The prep chip's number already includes busy minutes (get_prep_estimates); say so.
function busyNow(r: { busy_extra_minutes: number; busy_until: string | null } | null) {
  return !!r && r.busy_extra_minutes > 0 && !!r.busy_until && new Date(r.busy_until).getTime() > Date.now();
}

export default async function RestaurantOrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A partner can be staffed at 2+ restaurants — .maybeSingle() THROWS on more
  // than one row. Take the primary (oldest) link so the queue never 500s.
  const { data: staffRows } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id, restaurants(accept_sla_minutes, lat, lng, busy_extra_minutes, busy_until)")
    .eq("user_id", user?.id ?? "")
    .order("created_at", { ascending: true })
    .limit(1);
  const staffRow = staffRows?.[0] ?? null;

  // restaurant_staff.restaurant_id -> restaurants is a to-ONE FK, so PostgREST
  // embeds an object, not an array.
  const rest = staffRow?.restaurants as unknown as {
    accept_sla_minutes: number;
    lat: number | null;
    lng: number | null;
    busy_extra_minutes: number;
    busy_until: string | null;
  } | null;
  const acceptSlaMinutes = rest?.accept_sla_minutes ?? 7;
  const restaurantPoint = rest?.lat != null && rest?.lng != null ? { lat: rest.lat, lng: rest.lng } : null;

  // WS4 — the restaurant's own live prep estimate (drives the kitchen header chip).
  let prepEstimate: PrepEstimate | null = null;
  // Order 4 — this restaurant's own wait/prep KPI row (has_restaurant_access scoped).
  let waitKpi: RestaurantWaitKpiRow | null = null;
  if (staffRow?.restaurant_id) {
    const [prepRows, { data: kpiRow }] = await Promise.all([
      getPrepEstimates(supabase, [staffRow.restaurant_id]),
      supabase.from("restaurant_wait_kpis").select("*").eq("restaurant_id", staffRow.restaurant_id).maybeSingle(),
    ]);
    prepEstimate = ((prepRows ?? []) as PrepEstimate[])[0] ?? null;
    waitKpi = (kpiRow as RestaurantWaitKpiRow | null) ?? null;
  }

  // RLS (orders_partner_scope) already restricts this to the caller's own
  // restaurant. Catering orders are excluded — accepting one here would skip
  // the quote flow entirely; they live in /restaurant/catering.
  const { data: orders } = await supabase
    .from("orders")
    // Only what the queue renders: `*` shipped customer_id, the delivery address id, payment
    // internals and the idempotency key into the client payload of the kitchen tablet.
    .select(
      "id, order_number, order_type, status, total_mdl, requested_for, courier_id, created_at, estimated_ready_at, prep_time_override_minutes, order_items(*)",
    )
    .eq("order_type", "standard")
    .in("status", QUEUE_STATUSES)
    .order("created_at");

  // Split the embedded items off each row so OrderQueueRow gets a plain Order
  // plus its line items (qty × name + modifiers + notes) — the kitchen needs to
  // see WHAT to cook, not just the total.
  const rawOrders = (orders ?? []) as unknown as (Order & { order_items: OrderItem[] })[];
  const itemsByOrder = new Map<string, OrderItem[]>(
    rawOrders.map((o) => [o.id, (o.order_items ?? []) as OrderItem[]]),
  );
  const orderList = rawOrders as unknown as Order[];

  // Pickup coordination: a courier assigned to one of our orders is heading here.
  // Name + phone come from restaurant_courier_contact: partners have no read on
  // `couriers` under RLS (the old direct select always returned null).
  const assigned = orderList.find((o) => o.status === "courier_assigned" && o.courier_id);
  let pickupCourier: {
    id: string;
    name: string | null;
    phone: string | null;
    pos: { lat: number; lng: number } | null;
  } | null = null;
  if (assigned?.courier_id) {
    const [{ data: cl }, { data: contact }] = await Promise.all([
      supabase.from("courier_locations").select("lat, lng").eq("courier_id", assigned.courier_id).maybeSingle(),
      supabase.rpc("restaurant_courier_contact", { p_order_id: assigned.id }),
    ]);
    const c = contact?.[0];
    pickupCourier = {
      id: assigned.courier_id,
      name: c?.first_name || null,
      phone: c?.phone || null,
      pos: cl?.lat != null && cl?.lng != null ? { lat: cl.lat, lng: cl.lng } : null,
    };
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      {/* IERARHIA CERUTĂ DE §4 din rubrică: „comenzi noi > timp de preparare >
          încasări. Nu invers." Era fix invers, și se vedea în captură: la
          390×844 primul ecran al partenerului însemna antet + bandă de crest +
          butonul de notificări + patru pastile cu statistici pe 30 de zile, iar
          titlul „Comenzi" începea la ~830 px din 844. Omul de la tejghea, cu 20
          de secunde de atenție, trebuia să deruleze ca să vadă comanda care
          tocmai intrase — sub o medie de acum o lună.

          Ordinea de acum, de sus în jos: coada (decizia de ACUM, cu timpul de
          pregătire lipit de ea fiindcă e treapta a doua a ierarhiei ȘI e
          promisiunea pe care coada o face) → harta curierului care vine la
          ridicare, imediat sub comanda la care se referă → statisticile pe 30
          de zile → invitația la notificări. Nimic șters, doar pus în ordinea în
          care se iau deciziile. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {/* `flex-wrap` fiindcă `OrderQueueLive` randează aici DOUĂ lucruri: o
            pastilă mică lângă titlu și, când legătura cade, banda de
            reconectare pe toată lățimea. Fără dreptul de a se rupe, banda ar
            strivi titlul în loc să coboare sub el. */}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="pg-gold-text font-serif text-2xl font-bold">Comenzi</h1>
          <Link href="/restaurant/orders/history" className="text-xs text-white/50 transition hover:text-gold hover:underline">
            Istoric 30 zile →
          </Link>
          <Link href="/restaurant/stoc" className="text-xs text-white/50 transition hover:text-gold hover:underline">
            Stoc epuizat →
          </Link>
          <Link href="/restaurant/tableta" className="text-xs text-white/50 transition hover:text-gold hover:underline">
            Verifică tableta →
          </Link>
          {/* Pastila „Live" era scrisă aici de mână, deci rămânea aprinsă și
              atunci când `OrderQueueLive` afișa în josul ACELEIAȘI pagini banda
              „Reconectare la actualizări live…". Acum o desenează componenta
              care ține conexiunea — un singur adevăr, în locul a două. */}
          {staffRow && (
            <OrderQueueLive
              restaurantId={staffRow.restaurant_id}
              pending={orderList
                .filter((o) => o.status === "pending_restaurant")
                .map((o) => ({ id: o.id, created_at: o.created_at, requested_for: o.requested_for }))}
              starts={orderList
                .filter((o) => o.status === "accepted" && o.requested_for)
                .map((o) => ({
                  id: o.id,
                  status: o.status,
                  requested_for: o.requested_for,
                  estimated_ready_at: o.estimated_ready_at,
                  prep_time_override_minutes: o.prep_time_override_minutes ?? null,
                }))}
              venuePrepMinutes={prepEstimate?.prep_minutes ?? 30}
              showConnection
            />
          )}
        </div>
        {prepEstimate && (
          // Pe telefon rândul se rupea între „~34" și „min" (captură 390×844,
          // 2026-08-16): valoarea și unitatea nu se mai despart niciodată, iar
          // pastila are voie să se așeze pe două rânduri fără să taie o cifră.
          <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 ring-1 ring-white/10">
            {/* Punct STATIC, nu `pg-live-dot`. Cifra de lângă el vine din
                `get_prep_estimates`, adică o medie pe 28 de zile (sau pe ora
                curentă) — o măsurătoare, nu un semnal viu. Un punct care
                pulsează promite „acum", exact minciuna reparată în V11 pe
                celelalte două pastile ale aceleiași pagini. Culoarea rămâne
                ametistul casei, ca pastila să arate la fel; doar promisiunea
                dispare. */}
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[color:var(--pg-amethyst-2)]" aria-hidden />
            ⏱ Timp de pregătire estimat:{" "}
            <span className="pg-gold-text whitespace-nowrap font-semibold">~{prepEstimate.prep_minutes} min</span>
            <span className="text-white/40">
              {busyNow(rest)
                ? `(include +${rest!.busy_extra_minutes} min, mod aglomerat)`
                : prepEstimate.source === "static"
                ? "(valoare implicită)"
                : prepEstimate.source === "hourly"
                  ? "(medie pentru ora curentă)"
                  : "(medie ultimele 28 zile)"}
            </span>
          </span>
        )}
      </div>
      {rest && (
        <div className="mb-4">
          <BusyModeControl extraMinutes={rest.busy_extra_minutes} until={rest.busy_until} />
        </div>
      )}
      {orderList.length === 0 ? (
        <div className="pg-card flex flex-col items-center gap-3 py-14 text-center">
          <span className="text-5xl" aria-hidden>🍱</span>
          <p className="text-white/60">Nicio comandă activă — cele noi apar aici instant.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orderList.map((order) => (
            <OrderQueueRow
              key={order.id}
              order={order}
              items={itemsByOrder.get(order.id) ?? []}
              acceptSlaMinutes={acceptSlaMinutes}
              venuePrepMinutes={prepEstimate?.prep_minutes ?? 30}
            />
          ))}
        </ul>
      )}

      {pickupCourier && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-white/5 px-4 py-3 text-sm ring-1 ring-white/10">
          <span className="text-white/80">
            🛵 Curier: <span className="font-semibold text-white">{pickupCourier.name ?? "atribuit"}</span>
            {assigned && <span className="text-white/45"> · {assigned.order_number}</span>}
          </span>
          {pickupCourier.phone && (
            <a
              href={`tel:${pickupCourier.phone}`}
              className="ml-auto inline-flex min-h-11 items-center rounded-full bg-white/10 px-4 text-xs font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
            >
              📞 Sună curierul · {pickupCourier.phone}
            </a>
          )}
        </div>
      )}
      {restaurantPoint && pickupCourier && (
        <div className="mt-3">
          <RestaurantPickupMap
            key={pickupCourier.id}
            restaurant={restaurantPoint}
            courierId={pickupCourier.id}
            courierName={pickupCourier.name}
            initialCourier={pickupCourier.pos}
          />
        </div>
      )}
      {waitKpi && (
        <div className="mt-8">
          <RestaurantWaitKpiChips kpi={waitKpi} />
        </div>
      )}
      {/* Web Push opt-in so the partner gets the "Comandă nouă" alert even with the
          tab backgrounded — the marquee reliable-outbox feature (audit HIGH #3).
          Rămâne pe pagină, dar la subsol: e o setare de făcut o dată, nu o
          decizie de luat la fiecare comandă. */}
      <div className="mt-6">
        <PushOptIn />
      </div>
    </main>
  );
}
