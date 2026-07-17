// Hand-written domain types mirroring the Supabase schema in supabase/migrations/.
// Once the project is live, run `scripts/gen-types.sh` to generate the full
// database.types.ts from the real schema and prefer that for query results —
// these stay as the app's stable, readable domain vocabulary.

export type UserRole = "customer" | "courier" | "restaurant_partner" | "platform_admin";

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export type CuisineType = "sushi" | "fine_dining" | "other";

export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  cuisine_type: CuisineType;
  description: string | null;
  logo_url: string | null;
  cover_photo_url: string | null;
  address: string;
  sector: string | null;
  phone: string;
  is_active: boolean;
  accepting_orders: boolean;
  accepts_catering: boolean;
  delivery_fee_mdl: number;
  min_order_amount_mdl: number;
  catering_min_amount_mdl: number | null;
  avg_prep_minutes: number;
  accept_sla_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface MenuCategory {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price_mdl: number;
  photo_url: string | null;
  is_available: boolean;
  is_catering_only: boolean;
  catering_min_qty: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RestaurantHours {
  id: string;
  restaurant_id: string;
  day_of_week: number; // 0 = Sunday .. 6 = Saturday
  opens_at: string;
  closes_at: string;
  is_closed: boolean;
}

export interface Address {
  id: string;
  customer_id: string;
  label: string | null;
  street_address: string;
  sector: string | null;
  building: string | null;
  apartment: string | null;
  entrance: string | null;
  floor: string | null;
  intercom_code: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  is_default: boolean;
  created_at: string;
}

export type OrderType = "standard" | "catering";

export type OrderStatus =
  | "pending_restaurant"
  | "accepted"
  | "ready_for_pickup"
  | "courier_assigned"
  | "picked_up"
  | "en_route"
  | "delivered"
  | "cancelled"
  | "rejected";

export type PaymentMethod = "cash" | "card_on_delivery" | "online_gateway";

export type PaymentStatus = "unpaid" | "pending_capture" | "paid" | "refund_pending" | "refunded" | "failed";

export interface Order {
  id: string;
  order_number: string;
  order_type: OrderType;
  customer_id: string;
  restaurant_id: string;
  delivery_address_id: string | null;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  subtotal_mdl: number;
  delivery_fee_mdl: number;
  total_mdl: number;
  requested_for: string | null;
  courier_id: string | null;
  notes: string | null;
  cancellation_reason: string | null;
  estimated_ready_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PrepEstimate = {
  restaurant_id: string;
  prep_minutes: number;
  source: "hourly" | "overall" | "static";
  sample_count: number;
};

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  item_name_snapshot: string;
  unit_price_mdl: number;
  quantity: number;
  line_total_mdl: number;
  notes: string | null;
}

export type QuoteStatus = "requested" | "quoted" | "confirmed" | "declined";

export interface CateringDetails {
  order_id: string;
  event_date: string;
  event_time: string | null;
  guest_count: number;
  event_address_text: string;
  contact_person: string;
  contact_phone: string;
  quote_status: QuoteStatus;
  quoted_total_mdl: number | null;
  restaurant_notes: string | null;
  created_at: string;
}

export interface DeliveryStatusEvent {
  id: string;
  order_id: string;
  status: string;
  actor_role: string;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "cash",
  card_on_delivery: "card la livrare",
  online_gateway: "plătit online",
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_restaurant: "În așteptare",
  accepted: "Acceptată",
  ready_for_pickup: "Gata de ridicare",
  courier_assigned: "Curier atribuit",
  picked_up: "Ridicată",
  en_route: "Pe drum",
  delivered: "Livrată",
  cancelled: "Anulată",
  rejected: "Refuzată",
};
