import { supabase } from "./supabase";
import type { LatLng } from "./realtime";

// Everything the tracking screen needs about ONE order, read under RLS (the customer
// sees only their own order, its restaurant, its address, its catering details).

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  orderType: string;
  paymentMethod: string;
  subtotalMdl: number;
  deliveryFeeMdl: number;
  tipMdl: number;
  totalMdl: number;
  courierId: string | null;
  estimatedReadyAt: string | null;
  requestedFor: string | null;
  createdAt: string;
  restaurant: { name: string; lat: number | null; lng: number | null } | null;
  dropoff: LatLng | null;
  dropoffText: string | null;
  items: { name: string; quantity: number; unitPriceMdl: number }[];
  catering: { quoteStatus: string; quotedTotalMdl: number | null; eventDate: string; guestCount: number } | null;
  ratedTargets: string[];
}

const ORDER_COLS =
  "id, order_number, status, order_type, payment_method, subtotal_mdl, delivery_fee_mdl, tip_mdl, total_mdl, courier_id, estimated_ready_at, requested_for, created_at, delivery_address_id, restaurant_id";

type OrderRow = {
  id: string; order_number: string; status: string; order_type: string; payment_method: string; subtotal_mdl: number;
  delivery_fee_mdl: number; tip_mdl: number; total_mdl: number; courier_id: string | null; estimated_ready_at: string | null;
  requested_for: string | null; created_at: string; delivery_address_id: string | null; restaurant_id: string;
};

/** Applies a realtime/poll row onto a detail (only the fields that move). */
export function mergeOrderRow(detail: OrderDetail, row: Partial<OrderRow>): OrderDetail {
  return {
    ...detail,
    status: row.status ?? detail.status,
    courierId: row.courier_id !== undefined ? row.courier_id : detail.courierId,
    tipMdl: row.tip_mdl != null ? Number(row.tip_mdl) : detail.tipMdl,
    totalMdl: row.total_mdl != null ? Number(row.total_mdl) : detail.totalMdl,
    estimatedReadyAt: row.estimated_ready_at !== undefined ? row.estimated_ready_at : detail.estimatedReadyAt,
  };
}

export async function fetchOrderRow(orderId: string): Promise<Partial<OrderRow> | null> {
  const { data } = await supabase.from("orders").select(ORDER_COLS).eq("id", orderId).maybeSingle();
  return data;
}

export async function fetchOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const { data: o, error } = await supabase.from("orders").select(ORDER_COLS).eq("id", orderId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!o) return null;
  const [restaurant, address, items, catering, ratings] = await Promise.all([
    supabase.from("restaurants").select("name, lat, lng").eq("id", o.restaurant_id).maybeSingle(),
    o.delivery_address_id
      ? supabase.from("addresses").select("street_address, lat, lng").eq("id", o.delivery_address_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("order_items").select("item_name_snapshot, quantity, unit_price_mdl").eq("order_id", orderId),
    o.order_type === "catering"
      ? supabase.from("catering_details").select("quote_status, quoted_total_mdl, event_date, guest_count").eq("order_id", orderId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("ratings").select("target_type").eq("order_id", orderId),
  ]);
  const a = address.data as { street_address: string; lat: number | null; lng: number | null } | null;
  const c = catering.data as { quote_status: string; quoted_total_mdl: number | null; event_date: string; guest_count: number } | null;
  return {
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    orderType: o.order_type,
    paymentMethod: o.payment_method,
    subtotalMdl: Number(o.subtotal_mdl),
    deliveryFeeMdl: Number(o.delivery_fee_mdl),
    tipMdl: Number(o.tip_mdl),
    totalMdl: Number(o.total_mdl),
    courierId: o.courier_id,
    estimatedReadyAt: o.estimated_ready_at,
    requestedFor: o.requested_for,
    createdAt: o.created_at,
    restaurant: restaurant.data,
    dropoff: a?.lat != null && a?.lng != null ? { lat: a.lat, lng: a.lng } : null,
    dropoffText: a?.street_address ?? null,
    items: (items.data ?? []).map((i) => ({
      name: i.item_name_snapshot,
      quantity: i.quantity,
      unitPriceMdl: Number(i.unit_price_mdl),
    })),
    catering: c
      ? { quoteStatus: c.quote_status, quotedTotalMdl: c.quoted_total_mdl, eventDate: c.event_date, guestCount: c.guest_count }
      : null,
    ratedTargets: (ratings.data ?? []).map((r) => r.target_type),
  };
}

/** Last known courier position (≤2 min old, mirrors the DB TTL) — fills the map
 *  before the next ~10s broadcast tick arrives. */
export async function fetchCourierSeed(courierId: string): Promise<LatLng | null> {
  const { data } = await supabase.from("courier_locations").select("lat, lng, updated_at").eq("courier_id", courierId).maybeSingle();
  if (!data || Date.now() - Date.parse(data.updated_at) >= 120_000) return null;
  return { lat: data.lat, lng: data.lng };
}
