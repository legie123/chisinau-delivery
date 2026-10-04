// Reusable steps of the cross-app flow. Every call goes through the real shared-api wrapper as
// the real role (client / restaurant partner / courier / platform admin), against the local stack.
import { randomUUID } from "node:crypto";
import {
  acceptDispatchOffer,
  acceptOrder,
  advanceDeliveryStatus,
  courierArrivedAtRestaurant,
  markReadyForPickup,
  placeOrder,
  RpcError,
  setCourierOnlineStatus,
  type PlaceOrderInput,
} from "@chisinau/shared-api";
import type { CourierId, OfferId, OrderId } from "@chisinau/shared-types";
import { check, sql, until, type Session } from "./harness";

export const REST = "11111111-1111-1111-1111-111111111111"; // Sakura Sushi (24 h, partner a..03)
export const REST_POINT = { lat: 47.0245, lng: 28.8322 };

export type CourierKey = "R" | "N" | "G";
export type Courier = { s: Session; id: string; at: { lat: number; lng: number } };
export type Actors = { client: Session; partner: Session; admin: Session; couriers: Record<CourierKey, Courier>; addressId: string; run: string };

export class Abort extends Error {}

/** State shared between scenarios (E1 order id, couriers' float before the run). */
export const memo: Record<string, string> = {};

/** One recorded step: ok when fn resolves; a throw is recorded and aborts the scenario. */
export async function step<T>(scenario: string, name: string, fn: () => Promise<T>, detail?: (v: T) => string): Promise<T> {
  try {
    const v = await fn();
    check(scenario, name, true, detail ? detail(v) : "");
    return v;
  } catch (e) {
    check(scenario, name, false, e instanceof Error ? e.message : String(e));
    throw new Abort(scenario);
  }
}

/** A soft equality check (the scenario goes on when it fails). */
export function eq(scenario: string, name: string, actual: unknown, expected: unknown, note = "") {
  const ok = String(actual) === String(expected);
  check(scenario, name, ok, ok ? `${actual}${note}` : `așteptat ${expected}, găsit ${actual}`);
  return ok;
}

/** The call MUST fail with a Romanian user message matching `re`. */
export async function mustFail(scenario: string, name: string, fn: () => Promise<unknown>, re: RegExp) {
  try {
    await fn();
    check(scenario, name, false, "a reușit, deși trebuia refuzat");
  } catch (e) {
    const msg = e instanceof RpcError ? e.userMessage : e instanceof Error ? e.message : String(e);
    check(scenario, name, re.test(msg), `„${msg}”`);
  }
}

export const oid = (s: string) => s as unknown as OrderId;

export type Row = { status: string; pay: string; courier: string; subtotal: number; fee: number; tip: number; total: number; no: string; delivered: boolean; courierFee: number; type: string };
export function row(orderId: string): Row {
  const r = sql(
    `select status, payment_status, coalesce(courier_id::text,''), subtotal_mdl, delivery_fee_mdl, coalesce(tip_mdl,0), total_mdl, order_number, delivered_at is not null, coalesce(courier_fee_mdl,-1), order_type from orders where id='${orderId}'`,
  )[0];
  return { status: r[0], pay: r[1], courier: r[2], subtotal: +r[3], fee: +r[4], tip: +r[5], total: +r[6], no: r[7], delivered: r[8] === "t", courierFee: +r[9], type: r[10] };
}

export async function sees(s: Session, orderId: string): Promise<boolean> {
  const { data } = await s.db.from("orders").select("id").eq("id", orderId).maybeSingle();
  return !!data;
}

export const trail = (orderId: string) => sql(`select status from delivery_status_events where order_id='${orderId}' order by created_at, id`).map((r) => r[0]);

export function itemId(name: string): string {
  return sql(`select id from menu_items where restaurant_id='${REST}' and name='${name}' and is_available`)[0][0];
}
export function optionId(item: string, group: string, option: string): string {
  return sql(
    `select o.id from menu_options o join menu_option_groups g on g.id=o.group_id join menu_items m on m.id=g.menu_item_id where m.restaurant_id='${REST}' and m.name='${item}' and g.name='${group}' and o.name='${option}'`,
  )[0][0];
}

export async function place(A: Actors, tag: string, input: Partial<PlaceOrderInput> & Pick<PlaceOrderInput, "paymentMethod" | "items">) {
  return placeOrder(A.client.db, {
    restaurantId: REST,
    orderType: "standard",
    deliveryAddressId: A.addressId,
    notes: `E2E-${A.run}-${tag}`,
    idempotencyKey: randomUUID(),
    ...input,
  });
}

/** Only these couriers online (the rest offline), each with a fresh GPS point near the restaurant. */
export async function goOnly(A: Actors, keys: CourierKey[]) {
  for (const k of ["R", "N", "G"] as CourierKey[]) {
    const c = A.couriers[k];
    if (keys.includes(k)) {
      await setCourierOnlineStatus(c.s.db, true);
      const { error } = await c.s.db.from("courier_locations").upsert({ courier_id: c.id, lat: c.at.lat, lng: c.at.lng, accuracy_m: 8 });
      if (error) throw new Error(`gps ${k}: ${error.message}`);
    } else {
      await setCourierOnlineStatus(c.s.db, false).catch(() => undefined);
    }
  }
}

export async function liveOffer(c: Courier, orderId: string, ms = 12000): Promise<string> {
  return until(`oferta pentru ${orderId}`, async () => {
    const { data } = await c.s.db.from("dispatch_offers").select("id").eq("order_id", orderId).eq("courier_id", c.id).eq("status", "offered").maybeSingle();
    return data?.id;
  }, ms);
}

export const offerId = (s: string) => s as unknown as OfferId;
export const courierId = (s: string) => s as unknown as CourierId;

/** accept → ready → offer lands on `c` → claimed. Returns the offer id. */
export async function toAssigned(A: Actors, S: string, orderId: string, c: Courier, label: string) {
  await step(S, "restaurantul acceptă comanda (ETA setat)", async () => {
    await acceptOrder(A.partner.db, oid(orderId));
    if (sql(`select estimated_ready_at is not null from orders where id='${orderId}'`)[0][0] !== "t") throw new Error("estimated_ready_at lipsește după acceptare");
  }, () => `status ${row(orderId).status}, ETA setat`);
  await step(S, "restaurantul marchează „gata de ridicare”", () => markReadyForPickup(A.partner.db, oid(orderId)), () => `status ${row(orderId).status}`);
  const offer = await step(S, `oferta ajunge la curierul ${label}`, () => liveOffer(c, orderId), (o) => `oferta ${o.slice(0, 8)}`);
  await step(S, `curierul ${label} acceptă oferta`, () => acceptDispatchOffer(c.s.db, offerId(offer)), () => `status ${row(orderId).status}`);
  eq(S, `comanda e atribuită curierului ${label}`, row(orderId).courier, c.id);
  return offer;
}

/** courier_assigned → arrived → picked_up → en_route → delivered (+ payment confirmed). */
export async function deliver(S: Actors["run"], A: Actors, orderId: string, c: Courier, label: string) {
  await step(S, `curierul ${label} anunță sosirea la restaurant`, () => courierArrivedAtRestaurant(c.s.db, oid(orderId)));
  await step(S, `curierul ${label} trimite poziția GPS`, async () => {
    const { error } = await c.s.db.from("courier_locations").upsert({ courier_id: c.id, lat: c.at.lat, lng: c.at.lng, accuracy_m: 6 });
    if (error) throw new Error(error.message);
  });
  await step(S, "ridicat (picked_up)", () => advanceDeliveryStatus(c.s.db, oid(orderId), "picked_up", false), () => row(orderId).status);
  await step(S, "în drum (en_route)", () => advanceDeliveryStatus(c.s.db, oid(orderId), "en_route", false), () => row(orderId).status);
  await step(S, "livrat + plata confirmată", () => advanceDeliveryStatus(c.s.db, oid(orderId), "delivered", true), () => {
    const r = row(orderId);
    return `status ${r.status}, plată ${r.pay}, total ${r.total} MDL`;
  });
  const r = row(orderId);
  eq(S, "comanda e livrată și încasată", `${r.status}/${r.pay}`, "delivered/paid");
  check(S, "livrarea are marcaj de timp și taxă curier", r.delivered && r.courierFee >= 0, `delivered_at ${r.delivered ? "da" : "nu"}, taxă curier ${r.courierFee} MDL`);
}

export const balance = (c: Courier) => +sql(`select public.courier_cash_balance('${c.id}')`)[0][0];
/** The float recomputed from the raw movements (not through courier_cash_balance). */
export const ledgerSum = (c: Courier) => +sql(`select coalesce(sum(amount_mdl),0) from courier_cash_movements where courier_id='${c.id}'`)[0][0];

/** What a role reads for an order's courier_id through its own session (RLS applies). */
export async function courierSeenBy(s: Session, orderId: string): Promise<string | null> {
  const { data } = await s.db.from("orders").select("courier_id").eq("id", orderId).maybeSingle();
  return data ? (data.courier_id as string | null) ?? "" : null;
}
