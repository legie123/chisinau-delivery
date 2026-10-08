import type { Db } from "./supabase";

// Native twins of src/lib/realtime/{subscribeTable,courierLocation}.ts.
// - postgres_changes always row-filtered, channel name unique per call (a fixed name
//   throws "cannot add postgres_changes callbacks after subscribe()" on re-mount).
// - courier GPS: PRIVATE broadcast channel `order:{id}:location`; setAuth() hands the
//   user's JWT to the socket so realtime.messages RLS lets only this order's customer in.

export type LatLng = { lat: number; lng: number };

export function subscribeOrderRow(
  db: Db,
  orderId: string,
  onRow: (row: Record<string, unknown>) => void,
  onDegraded: () => void,
): () => void {
  const name = `order-status:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = db
    .channel(name)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `id=eq.${orderId}` }, (payload) => {
      // place_order INSERTs the row with totals 0 and fills them later in the same
      // transaction; a late INSERT event would flash "Total 0.00 MDL". The refetch
      // already has the inserted row — only changes matter here.
      if (payload.eventType === "INSERT") return;
      if (payload.new && "id" in payload.new) onRow(payload.new as Record<string, unknown>);
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onDegraded();
    });
  return () => {
    db.removeChannel(channel);
  };
}

/** Rows hanging off ONE order that the web tracker also follows live: new
 *  delivery_status_events (timeline) and catering_details (quote arrives/changes).
 *  Both filtered `order_id=eq.X`; any change → onChange (the screen refetches). */
export function subscribeOrderChildren(db: Db, orderId: string, onChange: () => void, onDegraded: () => void): () => void {
  const name = `order-children:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const filter = `order_id=eq.${orderId}`;
  const channel = db
    .channel(name)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "delivery_status_events", filter }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "catering_details", filter }, () => onChange())
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onDegraded();
    });
  return () => {
    db.removeChannel(channel);
  };
}

export function subscribeCourierLocation(db: Db, orderId: string, onUpdate: (p: LatLng) => void): () => void {
  const channel = db
    .channel(`order:${orderId}:location`, { config: { private: true } })
    .on("broadcast", { event: "location" }, ({ payload }) => {
      const p = payload as Partial<LatLng> | null;
      if (p && typeof p.lat === "number" && typeof p.lng === "number") onUpdate({ lat: p.lat, lng: p.lng });
    });
  let closed = false;
  void db.realtime.setAuth().finally(() => {
    if (!closed) channel.subscribe();
  });
  return () => {
    closed = true;
    db.removeChannel(channel);
  };
}
