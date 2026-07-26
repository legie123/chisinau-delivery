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
  rating_avg: number | null;
  rating_count: number;
  lat: number | null;
  lng: number | null;
  created_at: string;
  updated_at: string;
}

// WS3 — nearby_restaurants RPC row (Restaurant projection + great-circle distance).
export interface NearbyRestaurant {
  id: string;
  distance_m: number | null;
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

// Menu modifiers — an item can have option groups (required/optional), each with
// options carrying a price delta. place_order validates + recomputes server-side.
export interface MenuOption {
  id: string;
  group_id: string;
  name: string;
  price_delta_mdl: number;
  is_available: boolean;
  sort_order: number;
}

export interface MenuOptionGroup {
  id: string;
  menu_item_id: string;
  name: string;
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  options: MenuOption[];
}

// The snapshot of a chosen option stored on an order line.
export interface SelectedOption {
  group: string;
  name: string;
  price_delta_mdl: number;
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
  tip_mdl: number;
  created_at: string;
  updated_at: string;
}

// Platform foundation (2026-07-18) — Notifications / Payments / Onboarding / UX.
export interface PushSubscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
}

export interface Favorite {
  customer_id: string;
  restaurant_id: string;
  created_at: string;
}

export type PaymentIntentStatus = "pending" | "succeeded" | "failed" | "refunded" | "cancelled";
export interface PaymentIntent {
  id: string;
  order_id: string;
  amount_mdl: number;
  provider: string;
  provider_ref: string | null;
  status: PaymentIntentStatus;
  created_at: string;
  updated_at: string;
}

export type PayoutStatus = "pending" | "paid" | "failed";
export interface Payout {
  id: string;
  recipient_type: "courier" | "restaurant";
  recipient_id: string;
  period_start: string;
  period_end: string;
  orders_count: number;
  gross_mdl: number;
  commission_mdl: number;
  net_mdl: number;
  status: PayoutStatus;
  paid_at: string | null;
  created_at: string;
}

export type OnboardingStatus = "pending" | "approved" | "rejected";
export interface OnboardingApplication {
  id: string;
  user_id: string | null;
  applicant_type: "courier" | "restaurant";
  status: OnboardingStatus;
  full_name: string;
  phone: string;
  email: string | null;
  details: Record<string, unknown>;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface KycDocument {
  id: string;
  application_id: string;
  doc_type: string;
  storage_path: string;
  created_at: string;
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
  selected_options: SelectedOption[];
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

export type DispatchOfferStatus = "offered" | "accepted" | "declined" | "expired" | "cancelled";

export interface DispatchOffer {
  id: string;
  order_id: string;
  courier_id: string;
  wave: number;
  score: number;
  distance_km: number | null;
  status: DispatchOfferStatus;
  offered_at: string;
  expires_at: string;
  responded_at: string | null;
  created_at: string;
  orders?: Order | null;
}

export interface Rating {
  id: string;
  order_id: string;
  customer_id: string;
  target_type: "restaurant" | "courier";
  restaurant_id: string | null;
  courier_id: string | null;
  stars: number;
  comment: string | null;
  created_at: string;
}

// WS7 — admin ops views (security_invoker; platform_admin sees all, others scoped).
export interface AdminOrderBoardRow {
  id: string;
  order_number: string;
  order_type: OrderType;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  total_mdl: number;
  created_at: string;
  notes: string | null;
  restaurant_id: string;
  restaurant_name: string;
  accept_sla_minutes: number;
  avg_prep_minutes: number;
  courier_id: string | null;
  courier_name: string | null;
  courier_status: string | null;
  street_address: string | null;
  sector: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  in_state_since: string;
  in_state_seconds: number;
}

export interface AdminStuckOrderRow extends AdminOrderBoardRow {
  stuck_reason: string;
}

export interface AdminFleetRow {
  id: string;
  full_name: string;
  phone: string;
  vehicle_type: string;
  status: string;
  is_active: boolean;
  lat: number | null;
  lng: number | null;
  location_updated_at: string | null;
  location_stale: boolean;
  active_order_id: string | null;
  active_order_number: string | null;
  active_order_status: OrderStatus | null;
}

export interface AdminRestaurantKpiRow {
  id: string;
  name: string;
  is_active: boolean;
  accepting_orders: boolean;
  accept_sla_minutes: number;
  orders_7d: number;
  accepted_7d: number;
  rejected_7d: number;
  auto_cancelled_7d: number;
  acceptance_rate_7d: number | null;
  avg_accept_minutes_7d: number | null;
}

export interface AdminPaymentQueueRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  total_mdl: number;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  restaurant_name: string;
  courier_name: string | null;
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
