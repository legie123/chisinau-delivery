import { supabase } from "./supabase";

// UI shape MapScreen/ActiveDeliveryScreen already render.
export interface DriverOrder {
  id: string;
  restaurant: string;
  pickupAddress: string;
  deliveryAddress: string;
  distance: string;
  earnings: string;
  items: string;
  customerName: string;
  lat: number;
  lng: number;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function getSessionUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user.id ?? null;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: "local" });
}

// couriers RLS (couriers_self_read) only returns the caller's own row.
export async function getMyCourierId(): Promise<string | null> {
  const { data } = await supabase.from("couriers").select("id").maybeSingle();
  return data?.id ?? null;
}

function formatAddress(a: {
  street_address: string;
  building: string | null;
  apartment: string | null;
} | null): string {
  if (!a) return "Adresa se afișează după acceptare";
  return [a.street_address, a.building && `bloc ${a.building}`, a.apartment && `ap. ${a.apartment}`]
    .filter(Boolean)
    .join(", ");
}

// Chișinău fallback coordinates — the schema has no per-order lat/lng yet, so
// markers fan out around the city center until customers drop real pins.
// Also used by MapScreen/ActiveDeliveryScreen as the map's initial region and
// as a placeholder for the courier's own marker before a real GPS fix lands.
export const CHISINAU_CENTER = { lat: 47.0105, lng: 28.8638 };
const CENTER = CHISINAU_CENTER;

async function mapOrders(rows: Record<string, unknown>[]): Promise<DriverOrder[]> {
  const restaurantIds = [...new Set(rows.map((r) => r.restaurant_id as string))];
  const addressIds = rows.map((r) => r.delivery_address_id as string | null).filter(Boolean) as string[];

  const [{ data: restaurants }, { data: addresses }, { data: cateringRows }] = await Promise.all([
    restaurantIds.length > 0
      ? supabase.from("restaurants").select("id, name, address").in("id", restaurantIds)
      : Promise.resolve({ data: [] }),
    addressIds.length > 0
      ? supabase.from("addresses").select("id, street_address, building, apartment").in("id", addressIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("catering_details")
      .select("order_id, event_address_text")
      .in("order_id", rows.map((r) => r.id as string)),
  ]);

  const restaurantById = new Map((restaurants ?? []).map((r) => [r.id, r]));
  const addressById = new Map((addresses ?? []).map((a) => [a.id, a]));
  const cateringByOrder = new Map((cateringRows ?? []).map((c) => [c.order_id, c.event_address_text]));

  return rows.map((r, i) => {
    const restaurant = restaurantById.get(r.restaurant_id as string);
    const address = r.delivery_address_id ? (addressById.get(r.delivery_address_id as string) ?? null) : null;
    const cateringVenue = cateringByOrder.get(r.id as string);
    return {
      id: r.id as string,
      restaurant: restaurant?.name ?? "Restaurant",
      pickupAddress: restaurant?.address ?? "",
      deliveryAddress: cateringVenue ?? formatAddress(address),
      distance: "",
      earnings: `${r.delivery_fee_mdl} MDL`,
      items: `Comandă ${r.order_number} · total ${r.total_mdl} MDL`,
      customerName: (r.order_type as string) === "catering" ? "Eveniment catering" : "Client",
      lat: CENTER.lat + 0.004 * Math.sin(i * 2.1),
      lng: CENTER.lng + 0.006 * Math.cos(i * 2.1),
    };
  });
}

export async function fetchAvailableOrders(): Promise<DriverOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("status", "ready_for_pickup")
    .is("courier_id", null)
    .order("created_at");
  if (error) throw new Error(error.message);
  return mapOrders(data ?? []);
}

export async function fetchActiveOrder(): Promise<{ order: DriverOrder; status: string } | null> {
  const courierId = await getMyCourierId();
  if (!courierId) return null;
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .in("status", ["courier_assigned", "picked_up", "en_route"])
    .eq("courier_id", courierId)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return null;
  const [mapped] = await mapOrders(data);
  return { order: mapped, status: data[0].status as string };
}

export async function acceptOrder(orderId: string): Promise<string | null> {
  const { error } = await supabase.rpc("assign_courier", { p_order_id: orderId });
  return error ? error.message : null;
}

export async function advanceStatus(orderId: string, newStatus: string, paymentConfirmed?: boolean): Promise<string | null> {
  const { error } = await supabase.rpc("advance_delivery_status", {
    p_order_id: orderId,
    p_new_status: newStatus,
    p_payment_confirmed: paymentConfirmed ?? null,
  });
  return error ? error.message : null;
}

export async function setOnline(online: boolean): Promise<string | null> {
  const { error } = await supabase.rpc("set_courier_online_status", { p_status: online ? "online" : "offline" });
  return error ? error.message : null;
}

// ---------- History & earnings (video reference: Istoric Livrări) ----------

export interface DeliveredRow {
  id: string;
  orderNumber: string;
  restaurant: string;
  time: string;
  feeMdl: number;
  isToday: boolean;
}

export async function fetchDeliveryHistory(): Promise<{
  rows: DeliveredRow[];
  todayCount: number;
  todayEarnings: number;
}> {
  const courierId = await getMyCourierId();
  if (!courierId) return { rows: [], todayCount: 0, todayEarnings: 0 };
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, updated_at, delivery_fee_mdl, restaurants(name)")
    .eq("status", "delivered")
    .eq("courier_id", courierId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

  const todayStr = new Date().toLocaleDateString("ro-RO");
  const rows: DeliveredRow[] = (data ?? []).map((o) => {
    const d = new Date(o.updated_at as string);
    return {
      id: o.id as string,
      orderNumber: o.order_number as string,
      restaurant: ((o.restaurants as unknown as { name: string } | null)?.name) ?? "Restaurant",
      time: d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" }),
      feeMdl: Number(o.delivery_fee_mdl),
      isToday: d.toLocaleDateString("ro-RO") === todayStr,
    };
  });
  const today = rows.filter((r) => r.isToday);
  return {
    rows,
    todayCount: today.length,
    todayEarnings: today.reduce((sum, r) => sum + r.feeMdl, 0),
  };
}

// ---------- Push dispatch (dispatch_offers) ----------
// Mirrors src/components/courier/{OfferCard,OffersLive}.tsx on the web app:
// a scored offer lands as a dispatch_offers row for this courier; accept/decline
// go through the RPCs (never a raw orders update), and the offer feed is a
// row-filtered postgres_changes subscription, unique channel name per mount.

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

  const { data: orderRows, error: orderError } = await supabase.from("orders").select("*").eq("id", data.order_id);
  if (orderError) throw new Error(orderError.message);
  if (!orderRows || orderRows.length === 0) return null;
  const [order] = await mapOrders(orderRows);

  return {
    offer: {
      id: data.id as string,
      orderId: data.order_id as string,
      distanceKm: data.distance_km != null ? Number(data.distance_km) : null,
      expiresAt: data.expires_at as string,
    },
    order,
  };
}

export async function acceptDispatchOffer(offerId: string): Promise<string | null> {
  const { error } = await supabase.rpc("accept_dispatch_offer", { p_offer_id: offerId });
  return error ? error.message : null;
}

export async function declineDispatchOffer(offerId: string): Promise<string | null> {
  const { error } = await supabase.rpc("decline_dispatch_offer", { p_offer_id: offerId });
  return error ? error.message : null;
}

// Row-filtered by courier_id, unique channel name per mount (static names break
// on React re-mounts — same gotcha the web app's subscribeTable avoids).
export function subscribeMyDispatchOffers(courierId: string, onChange: () => void): () => void {
  const channelName = `driver-offers:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "dispatch_offers", filter: `courier_id=eq.${courierId}` },
      () => onChange(),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ---------- Courier profile (ProfileScreen) ----------

export type CourierStatus = "offline" | "online" | "on_delivery";

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
    id: data.id as string,
    fullName: data.full_name as string,
    phone: data.phone as string,
    vehicleType: data.vehicle_type as string,
    status: data.status as CourierStatus,
    ratingAvg: data.rating_avg != null ? Number(data.rating_avg) : null,
    ratingCount: data.rating_count as number,
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

// Same 14-day acceptance-rate definition the dispatch engine itself uses
// (see dispatch_order() in 20260717001600_dispatch_offers.sql) — real number,
// not a fabricated stat.
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

// ---------- Earnings (real money, mirrors src/app/(courier)/earnings/page.tsx) ----------

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
  weekEarningsMdl: number;
  weekOrdersCount: number;
  payouts: PayoutRow[];
}

export async function fetchEarningsSummary(): Promise<EarningsSummary> {
  const courierId = await getMyCourierId();
  if (!courierId) return { weekEarningsMdl: 0, weekOrdersCount: 0, payouts: [] };

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: weekOrders, error: ordersError }, { data: payoutRows, error: payoutsError }] = await Promise.all([
    supabase
      .from("orders")
      .select("delivery_fee_mdl, tip_mdl")
      .eq("courier_id", courierId)
      .eq("status", "delivered")
      .eq("payment_status", "paid")
      .gte("delivered_at", weekAgo),
    supabase
      .from("payouts")
      .select("*")
      .eq("recipient_type", "courier")
      .eq("recipient_id", courierId)
      .order("created_at", { ascending: false }),
  ]);
  if (ordersError) throw new Error(ordersError.message);
  if (payoutsError) throw new Error(payoutsError.message);

  const week = (weekOrders ?? []) as { delivery_fee_mdl: number; tip_mdl: number }[];
  const weekEarningsMdl = Math.round(week.reduce((sum, o) => sum + Number(o.delivery_fee_mdl) + Number(o.tip_mdl), 0) * 100) / 100;

  const payouts: PayoutRow[] = (payoutRows ?? []).map((p) => ({
    id: p.id as string,
    periodStart: p.period_start as string,
    periodEnd: p.period_end as string,
    ordersCount: p.orders_count as number,
    grossMdl: Number(p.gross_mdl),
    commissionMdl: Number(p.commission_mdl),
    netMdl: Number(p.net_mdl),
    status: p.status as PayoutStatus,
  }));

  return { weekEarningsMdl, weekOrdersCount: week.length, payouts };
}
