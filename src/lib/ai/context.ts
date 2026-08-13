import { createClient } from "@/lib/supabase/server";

// Pachetul de context al asistentului AI din panoul de comandă: un snapshot
// VIU al platformei (querii ieftine, rulate sub sesiunea adminului → RLS
// rămâne granița de securitate) + harta statică a aplicației și regulile de
// business. Totul e text — modelul primește o singură imagine coerentă, fără
// tool-calling (robust pe orice provider, inclusiv modele locale).

const SITE_MAP = `
HARTA APLICAȚIEI (Dragons Delivery — sushi/fine-dining + catering, Chișinău):
- Hub public "/" — intrare pe sectoare; /master = poarta proprietarului (parolă).
- Client: /restaurants (listă + program), /restaurants/[slug] (meniu),
  /cart, /checkout (COD cash ≤1400 MDL, card POS, programare livrare),
  /orders/[id] (tracking live + realtime), /catering (ofertă în 3 pași).
- Curier (PWA mobil separat, mobile/driver): oferte dispatch 30s, livrări,
  câștiguri (brut, înainte de comision), predare numerar.
- Restaurant: /restaurant/orders (SLA acceptare 7 min), meniu, program,
  catering (cotații), câștiguri, analiză.
- Platformă (admin): /platform Ops (KPI live + pilot go/no-go),
  /platform/orders (+tab Atenție = blocate/dispute), /platform/crm
  (Clienți/Restaurante/Curieri/Onboarding), /platform/payouts,
  /platform/fraud (+Reclamații), /platform/ai (acest chat).

REGULI DE BUSINESS CHEIE:
- Ciclul comenzii DOAR prin RPC-uri (place_order → accept → ready →
  dispatch_order → courier accept → picked_up → en_route → delivered);
  RLS e granița de securitate pe fiecare rol.
- Dispatch: un singur punct (dispatch_order), oferte 30s, val de 5/5min,
  cooldown 2 min pe oferte expirate, decline permanent pe comandă,
  gate cash-aware: balanță+total ≥ plafon ⇒ curierul nu primește cash
  standard (catering exempt). Plafon efectiv: 1500 MDL (1000 sub 30 zile
  vechime). COD cap: comenzi standard cash > 1400 MDL respinse la plasare.
- Programate: SLA ancorat la greatest(created_at, fereastră-60min);
  dispatch închis până la fereastră-45min. Zombie ready >6h se expiră.
- Numerar curieri: ledger append-only (collected/offload/refund_reversal);
  drift reconciliat periodic, flags la abateri.
- Payouts: admin_generate_payouts pe interval; view-ul de acoperire arată
  livrări încasate neacoperite de niciun payout.
`.trim();

export async function gatherOpsContext(): Promise<string> {
  const supabase = await createClient();
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    { count: activeNow },
    { count: todayTotal },
    delivered7dRes,
    stuckRes,
    couriersRes,
    { count: unpaidCoverage },
    { count: pendingOnboarding },
    { count: openFraud },
    { count: pendingCateringQuotes },
    customersRes,
    { count: restaurantsActive },
    { count: scheduledUpcoming },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending_restaurant", "accepted", "ready_for_pickup", "courier_assigned", "picked_up", "en_route"]),
    supabase.from("orders").select("id", { count: "exact", head: true }).gte("created_at", startOfToday.toISOString()),
    supabase.from("orders").select("total_mdl, order_type").eq("status", "delivered").gte("created_at", since7d).limit(2000),
    supabase.from("admin_stuck_orders").select("order_number, stuck_reason, in_state_seconds, restaurant_name").limit(15),
    supabase.from("couriers").select("full_name, status, is_active").limit(100),
    supabase.from("admin_unpaid_delivered_orders").select("id", { count: "exact", head: true }),
    supabase.from("onboarding_applications").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("fraud_flags").select("id", { count: "exact", head: true }).is("reviewed_at", null),
    supabase.from("catering_details").select("id", { count: "exact", head: true }).eq("quote_status", "pending"),
    supabase.from("admin_customers").select("id, spent_mdl, last_order_at").limit(1000),
    supabase.from("restaurants").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .gt("requested_for", new Date().toISOString())
      .in("status", ["pending_restaurant", "accepted", "ready_for_pickup"]),
  ]);

  const delivered7d = delivered7dRes.data ?? [];
  const revenue7d = delivered7d.reduce((s, o) => s + Number(o.total_mdl ?? 0), 0);
  const cateringRevenue7d = delivered7d
    .filter((o) => o.order_type === "catering")
    .reduce((s, o) => s + Number(o.total_mdl ?? 0), 0);

  const couriers = couriersRes.data ?? [];
  const online = couriers.filter((c) => c.status === "online" && c.is_active);

  const customers = customersRes.data ?? [];
  const activeCustomers30d = customers.filter(
    (c) => c.last_order_at && Date.parse(c.last_order_at) > Date.now() - 30 * 86400_000,
  ).length;

  const stuck = (stuckRes.data ?? [])
    .map(
      (s) =>
        `  - ${s.order_number} (${s.restaurant_name}): ${s.stuck_reason}, de ${Math.round(Number(s.in_state_seconds) / 60)} min`,
    )
    .join("\n");

  return `${SITE_MAP}

STARE LIVE (generat acum, ora Chișinău ${new Date().toLocaleString("ro-RO", { timeZone: "Europe/Chisinau" })}):
- Comenzi active acum: ${activeNow ?? 0} · plasate azi: ${todayTotal ?? 0} · programate viitoare: ${scheduledUpcoming ?? 0}
- Ultimele 7 zile: ${delivered7d.length} livrate, revenue ${revenue7d} MDL (din care catering ${cateringRevenue7d} MDL)
- Comenzi blocate (necesită intervenție): ${stuckRes.data?.length ?? 0}
${stuck || "  - niciuna 🎉"}
- Curieri: ${online.length} online din ${couriers.length} înregistrați (${online.map((c) => c.full_name).join(", ") || "niciunul online"})
- Restaurante active: ${restaurantsActive ?? 0}
- Clienți: ${customers.length} total, ${activeCustomers30d} activi în ultimele 30 zile
- Payouts: ${unpaidCoverage ?? 0} livrări încasate neacoperite de payout
- Onboarding în așteptare: ${pendingOnboarding ?? 0} · Semnalări fraud deschise: ${openFraud ?? 0} · Cotații catering în lucru: ${pendingCateringQuotes ?? 0}`;
}
