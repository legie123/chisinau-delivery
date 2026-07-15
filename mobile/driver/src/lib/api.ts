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
const CENTER = { lat: 47.0105, lng: 28.8638 };

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
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .in("status", ["courier_assigned", "picked_up", "en_route"])
    .not("courier_id", "is", null)
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
