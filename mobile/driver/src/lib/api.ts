import {
  RpcError,
  acceptDispatchOffer as rpcAcceptDispatchOffer,
  claimOrderAsCourier,
  courierArrivedAtRestaurant,
  declineDispatchOffer as rpcDeclineDispatchOffer,
  getCourierCashStatus,
  setCourierOnlineStatus,
  type CourierCashStatus,
} from "@chisinau/shared-api";
import {
  COMMISSION_PCT,
  isNetworkError,
  type CommissionSource,
  type EarningsSummary as MoneySummary,
  type PricingVersion,
} from "@chisinau/shared-domain";
import type { OfferId, OrderId } from "@chisinau/shared-types";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import {
  fetchCommissionPct,
  fetchPricingHistory,
  fetchTodayEarnings,
  fetchWeekEarnings,
  historyNet,
  offerNetLabel,
} from "./earnings";
import { stopDeliveryTracking } from "./backgroundLocation";
import { registerForPush, unregisterPush } from "./push";
import { addressLines, toPoint, type LatLng } from "./orderView";

// Every status change goes through @chisinau/shared-api (the same typed RPC
// wrappers the web uses); reads stay plain RLS-scoped selects. Money goes
// through ./earnings (= @chisinau/shared-domain, the web's canonical model).

// Romanian, user-facing, never swallowed: callers show this in an alert/banner.
export function userMessage(err: unknown, fallback = "A apărut o eroare. Încearcă din nou."): string {
  if (isNetworkError(err)) return "Fără conexiune — încearcă din nou când ai semnal.";
  if (err instanceof RpcError) return err.userMessage;
  return fallback;
}

async function attempt(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return userMessage(err);
  }
}

// UI shape MapScreen/ActiveDeliveryScreen already render.
export interface DriverOrder {
  id: string;
  status: string;
  restaurant: string;
  pickupAddress: string;
  deliveryAddress: string;
  distance: string;
  earnings: string; // NET of the quoted courier fee (floor), same as the web's „Câștig net"
  items: string;
  customerName: string;
  // Real points only: null when the restaurant/address has no pin (the map then
  // shows no marker instead of a made-up one). The drop-off is readable only
  // once the order is assigned to this courier (addresses_courier_assigned_read).
  pickup: LatLng | null;
  dropoff: LatLng | null;
  dropoffText: string | null; // real street (or catering venue); null until readable
  deliveryDoor: string; // bloc, scara, etaj, ap., interfon
  deliveryNotes: string | null;
  customerPhone: string | null;
  restaurantPhone: string | null;
}

const NOT_A_COURIER = "Contul acesta nu este de curier. Intră cu contul primit de la dispecerat.";

/** Romanian error, or null once a COURIER is signed in. Any other account is signed out again on the spot. */
export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return isNetworkError(error) ? userMessage(error) : "Autentificare eșuată. Verifică emailul și parola.";
  // A customer/restaurant account used to get in: the status button spun on "…"
  // forever and the phone registered a push token for a non-courier.
  courierIdCache = null;
  let courierId: string | null;
  try {
    courierId = await getMyCourierId();
  } catch (err) {
    await supabase.auth.signOut({ scope: "local" });
    return userMessage(err, "Nu am putut verifica contul de curier. Încearcă din nou.");
  }
  if (!courierId) {
    await supabase.auth.signOut({ scope: "local" });
    return NOT_A_COURIER;
  }
  return null;
}

/** App start: is the stored session a courier's? Signed out / no couriers row → false (and signed out). Offline or lapsed → trusted. */
export async function restoreCourierSession(): Promise<boolean> {
  const { data, error } = await supabase.auth.getSession();
  // No session + a retryable refresh failure = a stored session that lapsed in a dead zone (auth-js
  // keeps it): "cannot tell", not the login screen. A revoked one is removed (SIGNED_OUT) → false.
  if (!data.session) return isAuthRetryableFetchError(error);
  const courierId = await getMyCourierId().catch(() => undefined); // undefined = cannot tell right now
  if (courierId !== null) return true;
  await supabase.auth.signOut({ scope: "local" });
  return false;
}

// Sign-out must leave nothing running on this phone for the previous courier:
// no background GPS, no push token, and no "online" status that would keep
// sending them offers they can no longer see. A step that fails is RETURNED
// (Romanian) and the session is kept, so the courier can retry with signal —
// `force` (the explicit „Deconectează oricum”) skips those, but not the local
// sign-out itself: when that fails he is still signed in, and is told so.
export async function signOut(force = false): Promise<string | null> {
  if (!force) {
    // couriers.status alone is not proof of "no delivery": a cash-cap auto-offline turns an
    // en_route courier offline, and going offline then succeeds mid-delivery (verifier, 2026-10-04).
    const active = await hasActiveDelivery().catch(() => undefined);
    if (active === undefined) {
      return "Deconectarea nu e completă: nu am putut verifica livrarea activă. Nu te-am deconectat — încearcă din nou când ai semnal.";
    }
    if (active) return "Ai o livrare în curs — încheie-o înainte să te deconectezi. Nu te-am deconectat.";
  }
  // Offline next: the server refuses it during a delivery (or there is no
  // signal). A courier who stays signed in must keep GPS and the push token.
  const offlineError = await setOnline(false);
  if (offlineError && !force) {
    return `Deconectarea nu e completă: statusul nu a trecut pe offline (${offlineError}). Nu te-am deconectat.`;
  }
  const failed: string[] = [];
  await stopDeliveryTracking().catch((err: unknown) => {
    console.warn("[signOut] stop tracking", err);
    failed.push("GPS-ul nu s-a oprit (închide aplicația ca să-l oprești)");
  });
  let pushDeleted = true;
  await unregisterPush().catch((err: unknown) => {
    console.warn("[signOut] unregister push", err);
    pushDeleted = false;
    failed.push("notificările nu au fost oprite — poți primi în continuare oferte pe acest telefon");
  });
  if (failed.length > 0 && !force) {
    // Still signed in: a token already deleted is bound again, or offers stop until a restart.
    if (pushDeleted) await registerForPush().catch(() => undefined);
    return `Deconectarea nu e completă: ${failed.join("; ")}. Nu te-am deconectat — încearcă din nou.`;
  }
  courierIdCache = null;
  const local = await supabase.auth.signOut({ scope: "local" }).catch(() => null);
  if (!local) {
    // Clearing the local session threw (e.g. an Android keystore error) — possibly after /logout
    // already revoked it on the server, so the push token is NOT bound again on it (verifier, 2026-10-04).
    const push = pushDeleted ? " Notificările de oferte sunt oprite pe acest telefon." : "";
    return `Deconectarea nu e completă: sesiunea nu a putut fi închisă pe acest telefon.${push} Încearcă din nou.`;
  }
  if (!local.error) return null;
  // auth-js RETURNS this and keeps the session when /logout is not confirmed (no signal, GoTrue
  // 5xx/429, a lapsed session): still signed in, so a token deleted above is bound again.
  if (pushDeleted) await registerForPush().catch(() => undefined);
  return "Deconectarea nu e completă: serverul nu a confirmat închiderea sesiunii. Nu te-am deconectat — încearcă din nou când ai semnal.";
}

const ACTIVE_DELIVERY_STATUSES = ["courier_assigned", "picked_up", "en_route"];

/** Whether the server holds an order on this courier's hands (throws when it cannot tell). */
export async function hasActiveDelivery(): Promise<boolean> {
  const courierId = await getMyCourierId();
  if (!courierId) return false;
  const { data, error } = await supabase
    .from("orders")
    .select("id")
    .in("status", ACTIVE_DELIVERY_STATUSES)
    .eq("courier_id", courierId)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

// couriers RLS (couriers_self_read) only returns the caller's own row.
// null = signed in, not a courier. No session at hand is a lapse (refresh failing, keychain
// mid-rewrite) as often as a sign-out — and a signed-out phone is on the login screen anyway — so
// it throws "cannot tell": as null it stopped GPS mid-delivery in MapScreen and let an offer tap
// or a sign-out through hasActiveDelivery (verifier, 2026-10-04).
let courierIdCache: { userId: string; courierId: string | null } | null = null;
export async function getMyCourierId(): Promise<string | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new TypeError("network: no courier session");
  if (courierIdCache?.userId === userId) return courierIdCache.courierId;
  const { data, error } = await supabase.from("couriers").select("id").maybeSingle();
  if (error) throw new Error(error.message);
  courierIdCache = { userId, courierId: data?.id ?? null };
  return courierIdCache.courierId;
}

// The live commission changes rarely (versioned config); one read per 5 min
// keeps a 10s offer poll from doubling its request count. A FAILED read is
// never cached: the documented default serves this call only and the next call
// asks again (it used to pin the fallback for 5 minutes).
const PCT_TTL_MS = 5 * 60_000;
let pctCache: { at: number; pct: number } | null = null;
export async function getCommissionPct(): Promise<number> {
  if (pctCache && Date.now() - pctCache.at < PCT_TTL_MS) return pctCache.pct;
  const pct = await fetchCommissionPct(supabase);
  if (pct === null) return COMMISSION_PCT;
  pctCache = { at: Date.now(), pct };
  return pct;
}

// What DELIVERED orders are settled with: each order's pricing version at its
// delivered_at (pricing_config_at — what admin_generate_payouts pays). The live
// rate only when the history read soft-fails to [] (also never cached).
let historyCache: { at: number; history: PricingVersion[] } | null = null;
export async function getCommission(): Promise<CommissionSource> {
  if (historyCache && Date.now() - historyCache.at < PCT_TTL_MS) return historyCache.history;
  const history = await fetchPricingHistory(supabase);
  if (history.length === 0) return getCommissionPct();
  historyCache = { at: Date.now(), history };
  return history;
}

// Map's initial region and the courier's own marker before the first GPS fix.
// Never used as an order's position.
export const CHISINAU_CENTER = { lat: 47.0105, lng: 28.8638 };

const ADDRESS_COLUMNS =
  "id, street_address, building, entrance, floor, apartment, intercom_code, notes, contact_phone, lat, lng";

type OrderRow = {
  id: string;
  status: string;
  restaurant_id: string;
  delivery_address_id: string | null;
  order_number: string;
  total_mdl: number;
  order_type: string;
  delivery_fee_mdl: number;
  courier_fee_mdl: number | null;
  courier_fee_quoted_mdl: number | null;
};

const ORDER_COLUMNS =
  "id, status, restaurant_id, delivery_address_id, order_number, total_mdl, order_type, delivery_fee_mdl, courier_fee_mdl, courier_fee_quoted_mdl";

async function mapOrders(rows: OrderRow[]): Promise<DriverOrder[]> {
  if (rows.length === 0) return [];
  const restaurantIds = [...new Set(rows.map((r) => r.restaurant_id))];
  const addressIds = rows.map((r) => r.delivery_address_id).filter((x): x is string => !!x);

  const [restaurants, addresses, catering, pct] = await Promise.all([
    supabase.from("restaurants").select("id, name, address, phone, lat, lng").in("id", restaurantIds),
    addressIds.length > 0
      ? supabase.from("addresses").select(ADDRESS_COLUMNS).in("id", addressIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("catering_details")
      .select("order_id, event_address_text")
      .in("order_id", rows.map((r) => r.id)),
    getCommissionPct(),
  ]);
  for (const res of [restaurants, addresses, catering]) {
    if (res.error) throw new Error(res.error.message);
  }

  const restaurantById = new Map((restaurants.data ?? []).map((r) => [r.id, r]));
  const addressById = new Map((addresses.data ?? []).map((a) => [a.id, a]));
  const cateringByOrder = new Map((catering.data ?? []).map((c) => [c.order_id, c.event_address_text]));

  return rows.map((r) => {
    const restaurant = restaurantById.get(r.restaurant_id);
    const address = r.delivery_address_id ? (addressById.get(r.delivery_address_id) ?? null) : null;
    const cateringVenue = cateringByOrder.get(r.id);
    const lines = address ? addressLines(address) : null;
    return {
      id: r.id,
      status: r.status,
      restaurant: restaurant?.name ?? "Restaurant",
      pickupAddress: restaurant?.address ?? "",
      deliveryAddress: cateringVenue ?? lines?.street ?? "Adresa se afișează după acceptare",
      distance: "",
      earnings: offerNetLabel(r, pct),
      items: `Comandă ${r.order_number} · total ${r.total_mdl} MDL`,
      customerName: r.order_type === "catering" ? "Eveniment catering" : "Client",
      pickup: toPoint(restaurant?.lat, restaurant?.lng),
      dropoff: toPoint(address?.lat, address?.lng),
      dropoffText: cateringVenue ?? lines?.street ?? null,
      deliveryDoor: lines?.door ?? "",
      deliveryNotes: address?.notes ?? null,
      customerPhone: address?.contact_phone ?? null,
      restaurantPhone: restaurant?.phone ?? null,
    };
  });
}

export async function fetchAvailableOrders(): Promise<DriverOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("status", "ready_for_pickup")
    .is("courier_id", null)
    .order("created_at");
  if (error) throw new Error(error.message);
  return mapOrders((data ?? []) as OrderRow[]);
}

export async function fetchActiveOrder(): Promise<{ order: DriverOrder; status: string } | null> {
  const courierId = await getMyCourierId();
  if (!courierId) return null;
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .in("status", ["courier_assigned", "picked_up", "en_route"])
    .eq("courier_id", courierId)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return null;
  const [mapped] = await mapOrders(data as OrderRow[]);
  return { order: mapped, status: mapped.status };
}

/** Self-claim from the pull list (RPC assign_courier — self only). */
export function claimOrder(orderId: string): Promise<string | null> {
  return attempt(() => claimOrderAsCourier(supabase, orderId as OrderId));
}

export function markArrivedAtRestaurant(orderId: string): Promise<string | null> {
  return attempt(() => courierArrivedAtRestaurant(supabase, orderId as OrderId));
}

/** Last-known position while online and idle (see ./heartbeat). Romanian error or null. */
export async function upsertMyLocation(courierId: string, point: LatLng): Promise<string | null> {
  const { error } = await supabase
    .from("courier_locations")
    .upsert({ courier_id: courierId, lat: point.lat, lng: point.lng });
  return error ? userMessage(error, "Poziția nu a putut fi trimisă.") : null;
}

export function setOnline(online: boolean): Promise<string | null> {
  return attempt(() => setCourierOnlineStatus(supabase, online));
}

export type CourierStatus = "offline" | "online" | "on_delivery";

/** The SERVER's view of the courier's availability — the app never assumes "online". */
export async function fetchMyCourierStatus(): Promise<CourierStatus | null> {
  const { data, error } = await supabase.from("couriers").select("status").maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.status as CourierStatus | undefined) ?? null;
}

export function fetchCashStatus(): Promise<CourierCashStatus | null> {
  return getCourierCashStatus(supabase);
}

// ---------- History & earnings ----------

export interface DeliveredRow {
  id: string;
  orderNumber: string;
  restaurant: string;
  time: string;
  netMdl: number | null; // null = livrată dar neîncasată (not settled → never summed)
}

export async function fetchDeliveryHistory(): Promise<{ rows: DeliveredRow[]; today: MoneySummary }> {
  const courierId = await getMyCourierId();
  const empty = { ordersCount: 0, grossMdl: 0, commissionMdl: 0, netMdl: 0, pendingCount: 0 };
  if (!courierId) return { rows: [], today: empty };
  const commission = await getCommission();
  const [{ data, error }, today] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, delivered_at, updated_at, delivery_fee_mdl, courier_fee_mdl, tip_mdl, payment_status, restaurants(name)")
      .eq("status", "delivered")
      .eq("courier_id", courierId)
      .order("delivered_at", { ascending: false, nullsFirst: false })
      .limit(50),
    fetchTodayEarnings(supabase, courierId, commission),
  ]);
  if (error) throw new Error(error.message);

  const rows: DeliveredRow[] = (data ?? []).map((o) => {
    const d = new Date(o.delivered_at ?? o.updated_at);
    return {
      id: o.id,
      orderNumber: o.order_number,
      restaurant: (o.restaurants as unknown as { name: string } | null)?.name ?? "Restaurant",
      time: d.toLocaleString("ro-RO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      netMdl: historyNet(o, commission),
    };
  });
  return { rows, today };
}

/** "Azi ai câștigat" — net, settled only (unpaid cash is counted apart, as on the web). */
export async function fetchTodaySummary(): Promise<MoneySummary | null> {
  const courierId = await getMyCourierId();
  if (!courierId) return null;
  return fetchTodayEarnings(supabase, courierId, await getCommission());
}

// ---------- Push dispatch (dispatch_offers) ----------

export interface DispatchOfferRow {
  id: string;
  orderId: string;
  distanceKm: number | null;
  expiresAt: string;
}

export async function fetchMyLiveOffer(): Promise<{ offer: DispatchOfferRow; order: DriverOrder } | null> {
  const courierId = await getMyCourierId();
  if (!courierId) return null;
  const { data, error } = await supabase
    .from("dispatch_offers")
    .select("id, order_id, distance_km, expires_at")
    .eq("courier_id", courierId)
    .eq("status", "offered")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: orderRows, error: orderError } = await supabase.from("orders").select(ORDER_COLUMNS).eq("id", data.order_id);
  if (orderError) throw new Error(orderError.message);
  if (!orderRows || orderRows.length === 0) return null;
  const [order] = await mapOrders(orderRows as OrderRow[]);

  return {
    offer: {
      id: data.id,
      orderId: data.order_id,
      distanceKm: data.distance_km != null ? Number(data.distance_km) : null,
      expiresAt: data.expires_at,
    },
    order,
  };
}

export function acceptDispatchOffer(offerId: string): Promise<string | null> {
  return attempt(() => rpcAcceptDispatchOffer(supabase, offerId as OfferId));
}

export function declineDispatchOffer(offerId: string): Promise<string | null> {
  return attempt(() => rpcDeclineDispatchOffer(supabase, offerId as OfferId));
}

// Row-filtered by courier_id, unique channel name per subscribe (static names
// break on re-mounts — same rule as the web's subscribeTable). `onHealth`
// reports whether the socket is live, so the UI can say "reconectare…".
export function subscribeMyDispatchOffers(
  courierId: string,
  onChange: () => void,
  onHealth?: (healthy: boolean) => void,
): () => void {
  const channelName = `driver-offers:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "dispatch_offers", filter: `courier_id=eq.${courierId}` },
      () => onChange(),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onHealth?.(true);
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") onHealth?.(false);
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

// ---------- Courier profile (ProfileScreen) ----------

export interface CourierProfile {
  id: string;
  fullName: string;
  phone: string;
  vehicleType: string;
  status: CourierStatus;
  ratingAvg: number | null;
  ratingCount: number;
}

export async function getMyCourierProfile(): Promise<CourierProfile | null> {
  const { data, error } = await supabase
    .from("couriers")
    .select("id, full_name, phone, vehicle_type, status, rating_avg, rating_count")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    fullName: data.full_name,
    phone: data.phone,
    vehicleType: data.vehicle_type,
    status: data.status as CourierStatus,
    ratingAvg: data.rating_avg != null ? Number(data.rating_avg) : null,
    ratingCount: data.rating_count,
  };
}

export async function fetchDeliveredOrdersCount(): Promise<number> {
  const courierId = await getMyCourierId();
  if (!courierId) return 0;
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("courier_id", courierId)
    .eq("status", "delivered");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// Same 14-day acceptance-rate definition the dispatch engine historically used
// — shown to the courier as information only (dispatch no longer scores on it).
export async function fetchAcceptanceRate(): Promise<number | null> {
  const courierId = await getMyCourierId();
  if (!courierId) return null;
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("dispatch_offers")
    .select("status")
    .eq("courier_id", courierId)
    .in("status", ["accepted", "declined", "expired"])
    .gte("created_at", fourteenDaysAgo);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return null;
  const accepted = data.filter((o) => o.status === "accepted").length;
  return Math.round((accepted / data.length) * 100);
}

// ---------- Earnings (net, mirrors src/app/(courier)/earnings/page.tsx) ----------

export type PayoutStatus = "pending" | "paid" | "failed";

export interface PayoutRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  ordersCount: number;
  grossMdl: number;
  commissionMdl: number;
  netMdl: number;
  status: PayoutStatus;
}

export interface EarningsSummary {
  commissionPct: number;
  week: MoneySummary;
  payouts: PayoutRow[];
}

export async function fetchEarningsSummary(): Promise<EarningsSummary | null> {
  const courierId = await getMyCourierId();
  if (!courierId) return null;
  // Banner = the live rate; the week's money = each order's own version.
  const [commissionPct, commission] = await Promise.all([getCommissionPct(), getCommission()]);

  const [week, { data: payoutRows, error: payoutsError }] = await Promise.all([
    fetchWeekEarnings(supabase, courierId, commission),
    supabase
      .from("payouts")
      .select("*")
      .eq("recipient_type", "courier")
      .eq("recipient_id", courierId)
      .order("created_at", { ascending: false }),
  ]);
  if (payoutsError) throw new Error(payoutsError.message);

  const payouts: PayoutRow[] = (payoutRows ?? []).map((p) => ({
    id: p.id,
    periodStart: p.period_start,
    periodEnd: p.period_end,
    ordersCount: p.orders_count,
    grossMdl: Number(p.gross_mdl),
    commissionMdl: Number(p.commission_mdl),
    netMdl: Number(p.net_mdl),
    status: p.status as PayoutStatus,
  }));

  return { commissionPct, week, payouts };
}
