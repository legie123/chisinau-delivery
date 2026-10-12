import "server-only";
import { createSystemClient } from "@/lib/supabase/admin";
import { sendPushToUser, type PushPayload } from "./send";

// Domain notify helpers. They resolve the recipient with the service-role client
// (so a sender can notify a DIFFERENT user regardless of RLS) and are fully
// best-effort — any failure (incl. no service-role key configured) is swallowed.

export async function notifyOrderCustomer(orderId: string, payload: PushPayload): Promise<void> {
  try {
    const admin = createSystemClient();
    const { data } = await admin.from("orders").select("customer_id").eq("id", orderId).maybeSingle();
    if (data?.customer_id) await sendPushToUser(data.customer_id, payload);
  } catch {
    /* best-effort */
  }
}

export async function notifyDispatchedCourier(orderId: string, payload: PushPayload): Promise<void> {
  try {
    const admin = createSystemClient();
    const { data: offer } = await admin
      .from("dispatch_offers")
      .select("courier_id")
      .eq("order_id", orderId)
      .eq("status", "offered")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!offer?.courier_id) return;
    const { data: c } = await admin.from("couriers").select("user_id").eq("id", offer.courier_id).maybeSingle();
    if (c?.user_id) await sendPushToUser(c.user_id, payload);
  } catch {
    /* best-effort */
  }
}
